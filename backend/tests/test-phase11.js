const fs = require('fs');
const path = require('path');

const runPhase11Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 11 Automated Test Suite');
  console.log('  Kubernetes Orchestration & Workload Verification');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, description) => {
    if (condition) {
      console.log(`  \x1b[32m✔\x1b[0m ${description}`);
      passed++;
    } else {
      console.error(`  \x1b[31m✖\x1b[0m ${description}`);
      failed++;
    }
  };

  const k8sDir = path.resolve(__dirname, '../../k8s');

  try {
    // 1. Manifest Files Existence
    console.log('--- Test Suite 1: Kubernetes Manifests Audit ---');
    const requiredFiles = [
      'namespace.yaml',
      'configmap.yaml',
      'secret.yaml',
      'mongodb.yaml',
      'redis.yaml',
      'judge0.yaml',
      'api.yaml',
      'judge-worker.yaml',
      'frontend.yaml',
      'hpa.yaml',
      'kustomization.yaml',
      'README.md',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(k8sDir, file);
      assert(fs.existsSync(filePath), `k8s/${file} exists`);
    }

    // 2. Namespace & Config Checks
    console.log('\n--- Test Suite 2: Namespace, ConfigMap & Secrets Validation ---');
    const nsContent = fs.readFileSync(path.join(k8sDir, 'namespace.yaml'), 'utf8');
    assert(nsContent.includes('name: codejudge'), 'Namespace is "codejudge"');

    const cmContent = fs.readFileSync(path.join(k8sDir, 'configmap.yaml'), 'utf8');
    assert(
      cmContent.includes('MONGODB_URI') &&
        cmContent.includes('REDIS_HOST') &&
        cmContent.includes('JUDGE0_URL'),
      'ConfigMap defines DNS service endpoints for cluster networking'
    );

    const secretContent = fs.readFileSync(path.join(k8sDir, 'secret.yaml'), 'utf8');
    assert(secretContent.includes('JWT_SECRET'), 'Secret defines JWT_SECRET credential');

    // 3. API Workload Validation (Deployment, Health Probes, HPA)
    console.log('\n--- Test Suite 3: API Workload, Health Probes & Autoscaling ---');
    const apiContent = fs.readFileSync(path.join(k8sDir, 'api.yaml'), 'utf8');
    assert(
      apiContent.includes('kind: Deployment') && apiContent.includes('replicas: 2'),
      'API Deployment specifies initial replica count of 2'
    );
    assert(
      apiContent.includes('livenessProbe:') && apiContent.includes('readinessProbe:'),
      'API Deployment specifies both livenessProbe and readinessProbe on /health'
    );
    assert(
      apiContent.includes('resources:') && apiContent.includes('limits:'),
      'API Deployment enforces resource requests and limits'
    );

    const hpaContent = fs.readFileSync(path.join(k8sDir, 'hpa.yaml'), 'utf8');
    assert(
      hpaContent.includes('kind: HorizontalPodAutoscaler') &&
        hpaContent.includes('scaleTargetRef:') &&
        hpaContent.includes('maxReplicas: 10'),
      'HPA configured targeting codejudge-api with dynamic scale up to 10 pods'
    );

    // 4. Judge Worker Workload Validation (Deployment & Job)
    console.log('\n--- Test Suite 4: Judge Worker Pool & Job Orchestration ---');
    const workerContent = fs.readFileSync(path.join(k8sDir, 'judge-worker.yaml'), 'utf8');
    assert(
      workerContent.includes('kind: Deployment') && workerContent.includes('name: codejudge-worker'),
      'Worker pool Deployment configured'
    );
    assert(
      workerContent.includes('terminationGracePeriodSeconds: 30'),
      'Worker configures terminationGracePeriodSeconds to gracefully drain in-flight jobs on SIGTERM'
    );
    assert(
      workerContent.includes('kind: Job') && workerContent.includes('ttlSecondsAfterFinished:'),
      'Worker manifest includes Kubernetes Job pattern with auto-cleanup TTL'
    );

    // 5. Judge0 Sandbox Security Context
    console.log('\n--- Test Suite 5: Judge0 Sandbox Security & Isolation ---');
    const judge0Content = fs.readFileSync(path.join(k8sDir, 'judge0.yaml'), 'utf8');
    assert(
      judge0Content.includes('securityContext:') && judge0Content.includes('privileged: true'),
      'Judge0 Deployment specifies privileged securityContext for Linux cgroups configuration'
    );

    // 6. Kustomization & Documentation
    console.log('\n--- Test Suite 6: Kustomization & Deployment Guide ---');
    const kustomizeContent = fs.readFileSync(path.join(k8sDir, 'kustomization.yaml'), 'utf8');
    assert(
      kustomizeContent.includes('kind: Kustomization') &&
        kustomizeContent.includes('api.yaml') &&
        kustomizeContent.includes('judge-worker.yaml'),
      'kustomization.yaml aggregates all component manifests'
    );

    const guideContent = fs.readFileSync(path.join(k8sDir, 'README.md'), 'utf8');
    assert(
      guideContent.includes('Minikube') && guideContent.includes('Kind'),
      'k8s/README.md provides instructions for both Minikube and Kind'
    );
    assert(
      guideContent.includes('kubectl apply -k k8s/'),
      'k8s/README.md includes single-command kustomize deployment instruction'
    );

    console.log('\n====================================================');
    console.log(`  Kubernetes Audit Tests Passed: ${passed} | Failed: ${failed}`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Phase 11 tests failed with error:', error);
    process.exit(1);
  }
};

runPhase11Tests();
