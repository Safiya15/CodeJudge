# Kubernetes Deployment Guide for CodeJudge ☸️

This directory contains the production Kubernetes manifests for running CodeJudge on local clusters (**Minikube** or **Kind**) as well as managed cloud Kubernetes engines (GKE, EKS, AKS).

---

## 1. Local Cluster Setup

### Option A: Using Minikube

1. **Start Minikube with sufficient resources**:
   ```bash
   minikube start --cpus=4 --memory=8192 --addons=ingress,metrics-server
   ```

2. **Point your terminal to Minikube's Docker daemon** (to build images directly inside the cluster):
   ```bash
   # Linux / macOS
   eval $(minikube docker-env)

   # Windows PowerShell
   & minikube -p minikube docker-env --shell powershell | Invoke-Expression
   ```

3. **Build the container images**:
   ```bash
   # From the repository root
   docker build -t codejudge-backend:latest ./backend
   docker build -t codejudge-frontend:latest ./frontend
   ```

---

### Option B: Using Kind (Kubernetes in Docker)

1. **Create cluster**:
   ```bash
   kind create cluster --name codejudge
   ```

2. **Build and load images into Kind**:
   ```bash
   docker build -t codejudge-backend:latest ./backend
   docker build -t codejudge-frontend:latest ./frontend

   kind load docker-image codejudge-backend:latest --name codejudge
   kind load docker-image codejudge-frontend:latest --name codejudge
   ```

---

## 2. Deploying the Full Stack

Apply all manifests atomically using `kustomize`:

```bash
kubectl apply -k k8s/
```

Verify that all pods in the `codejudge` namespace transition to `Running`:

```bash
kubectl get pods -n codejudge -w
```

Example expected output:
```text
NAME                                 READY   STATUS    RESTARTS   AGE
codejudge-api-5d8f798c5f-a1b2c       1/1     Running   0          45s
codejudge-api-5d8f798c5f-d3e4f       1/1     Running   0          45s
codejudge-frontend-77699dcb75-k9m1   1/1     Running   0          45s
codejudge-frontend-77699dcb75-p2w8   1/1     Running   0          45s
codejudge-worker-674b48d6fb-j5n2p    1/1     Running   0          45s
codejudge-worker-674b48d6fb-x8q1m    1/1     Running   0          45s
codejudge-worker-674b48d6fb-z7l4v    1/1     Running   0          45s
judge0-6f987f6b4d-9m1pq              1/1     Running   0          50s
judge0-db-84b49cb977-w5t2x           1/1     Running   0          50s
mongodb-65c7866bc9-h7v3x             1/1     Running   0          50s
redis-767bb6c66d-c8p4m               1/1     Running   0          50s
```

---

## 3. Accessing the Services

### Minikube Service Access:
```bash
minikube service codejudge-frontend -n codejudge
```

### Port Forwarding (Kind or Minikube):
```bash
# Frontend Web UI (:3000)
kubectl port-forward svc/codejudge-frontend 3000:80 -n codejudge

# Backend Express API (:5000)
kubectl port-forward svc/codejudge-api 5000:5000 -n codejudge
```

---

## 4. Workload Architecture Details

| Manifest | Workload Kind | Scalability & Lifecycle |
| :--- | :--- | :--- |
| `api.yaml` | `Deployment` (Replicas: 2) | Stateless API instances. Automatically autoscaled (2 to 10 pods) via `hpa.yaml` based on 70% CPU target. |
| `judge-worker.yaml` | `Deployment` (Replicas: 3) | Asynchronous worker pool listening to Redis queue. Graceful termination (`terminationGracePeriodSeconds: 30`) ensures in-flight code evaluations finish on pod eviction. |
| `judge-worker.yaml` | `Job` Template | Demonstrates batch evaluation pattern: an ephemeral pod scheduled per batch that terminates with `ttlSecondsAfterFinished: 300`. |
| `judge0.yaml` | `Deployment` (Privileged) | Sandboxed isolate execution environment requiring Linux cgroups (`securityContext: privileged: true`). |
| `mongodb.yaml` / `redis.yaml` | `Deployment` + `PVC` | Stateful services backed by PersistentVolumeClaims. |
| `frontend.yaml` | `Deployment` + `Service` | High-performance Nginx static bundle with client-side SPA routing and WebSocket proxying. |
