const fs = require('fs');
const path = require('path');

const runPhase9Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 9 Automated Test Suite');
  console.log('  Docker Compose, Dockerfiles, & GitHub Actions CI');
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

  const rootDir = path.resolve(__dirname, '../../');

  try {
    // 1. Docker Compose Configuration Checks
    console.log('--- Test Suite 1: Docker Compose Specification ---');
    const composePath = path.join(rootDir, 'docker-compose.yml');
    assert(fs.existsSync(composePath), 'docker-compose.yml exists in repository root');

    const composeContent = fs.readFileSync(composePath, 'utf8');

    const requiredServices = [
      'mongodb',
      'redis',
      'judge0-db',
      'judge0-redis',
      'judge0',
      'api',
      'judge-worker',
      'frontend',
      'prometheus',
      'grafana',
    ];

    for (const service of requiredServices) {
      assert(
        composeContent.includes(`${service}:`),
        `Service "${service}" defined in docker-compose.yml`
      );
    }

    assert(
      composeContent.includes('privileged: true'),
      'Judge0 sandbox service configured with privileged access for cgroups'
    );
    assert(
      composeContent.includes('mongodb_data:') && composeContent.includes('redis_data:'),
      'Persistent volume mounts defined for database state'
    );
    assert(
      composeContent.includes('codejudge-network:'),
      'Isolated bridge network defined for inter-container communication'
    );

    // 2. Dockerfile Validations
    console.log('\n--- Test Suite 2: Dockerfiles & Production Containerization ---');
    const backendDockerPath = path.join(rootDir, 'backend/Dockerfile');
    assert(fs.existsSync(backendDockerPath), 'backend/Dockerfile exists');
    const backendDockerContent = fs.readFileSync(backendDockerPath, 'utf8');
    assert(
      backendDockerContent.includes('USER node'),
      'backend/Dockerfile adopts non-root user security principle'
    );
    assert(
      backendDockerContent.includes('HEALTHCHECK'),
      'backend/Dockerfile configures container healthcheck probe'
    );

    const frontendDockerPath = path.join(rootDir, 'frontend/Dockerfile');
    assert(fs.existsSync(frontendDockerPath), 'frontend/Dockerfile exists');
    const frontendDockerContent = fs.readFileSync(frontendDockerPath, 'utf8');
    assert(
      frontendDockerContent.includes('FROM node:') && frontendDockerContent.includes('FROM nginx:'),
      'frontend/Dockerfile implements multi-stage build (Node build -> Nginx runtime)'
    );

    const nginxPath = path.join(rootDir, 'frontend/nginx.conf');
    assert(fs.existsSync(nginxPath), 'frontend/nginx.conf exists');
    const nginxContent = fs.readFileSync(nginxPath, 'utf8');
    assert(
      nginxContent.includes('try_files $uri $uri/ /index.html;'),
      'Nginx configured with SPA history mode fallback'
    );
    assert(
      nginxContent.includes('proxy_pass http://api:5000/socket.io/;') &&
        nginxContent.includes('proxy_set_header Upgrade $http_upgrade;'),
      'Nginx configured with WebSocket reverse-proxy upgrade headers'
    );

    // 3. Prometheus & Grafana Provisioning
    console.log('\n--- Test Suite 3: Monitoring Provisioning ---');
    const promConfigPath = path.join(rootDir, 'monitoring/prometheus.yml');
    assert(fs.existsSync(promConfigPath), 'monitoring/prometheus.yml exists');
    const promConfigContent = fs.readFileSync(promConfigPath, 'utf8');
    assert(
      promConfigContent.includes('codejudge-api') && promConfigContent.includes('api:5000'),
      'Prometheus configured to scrape codejudge-api on :5000/metrics'
    );

    const gfDatasourcesPath = path.join(
      rootDir,
      'monitoring/grafana/provisioning/datasources/datasources.yml'
    );
    assert(fs.existsSync(gfDatasourcesPath), 'Grafana datasource provisioning config exists');

    const gfDashboardsPath = path.join(
      rootDir,
      'monitoring/grafana/provisioning/dashboards/dashboards.yml'
    );
    assert(fs.existsSync(gfDashboardsPath), 'Grafana dashboard provider provisioning config exists');

    // 4. Environment Variable Templates (.env.example)
    console.log('\n--- Test Suite 4: Environment Variable Templates ---');
    const rootEnvExample = path.join(rootDir, '.env.example');
    assert(fs.existsSync(rootEnvExample), 'Root .env.example exists');
    const rootEnvContent = fs.readFileSync(rootEnvExample, 'utf8');
    assert(
      rootEnvContent.includes('MONGODB_URI') &&
        rootEnvContent.includes('REDIS_HOST') &&
        rootEnvContent.includes('JUDGE0_URL') &&
        rootEnvContent.includes('JWT_SECRET'),
      'Root .env.example defines all required configuration parameters'
    );

    assert(fs.existsSync(path.join(rootDir, 'backend/.env.example')), 'backend/.env.example exists');
    assert(fs.existsSync(path.join(rootDir, 'frontend/.env.example')), 'frontend/.env.example exists');

    // 5. GitHub Actions Workflow Configuration
    console.log('\n--- Test Suite 5: GitHub Actions CI Pipeline ---');
    const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
    assert(fs.existsSync(ciPath), '.github/workflows/ci.yml exists');
    const ciContent = fs.readFileSync(ciPath, 'utf8');

    assert(
      ciContent.includes('name: CodeJudge CI Pipeline'),
      'CI workflow name is CodeJudge CI Pipeline'
    );
    assert(
      ciContent.includes('backend-test') &&
        ciContent.includes('frontend-build') &&
        ciContent.includes('docker-validate'),
      'CI workflow includes backend, frontend, and Docker validation jobs'
    );
    assert(
      ciContent.includes('npm run test:phase8'),
      'CI backend test job executes complete regression suite through Phase 8'
    );
    assert(
      ciContent.includes('docker compose config'),
      'CI includes docker compose config validation step'
    );

    console.log('\n====================================================');
    console.log(`  Tests Passed: ${passed} | Failed: ${failed}`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution failed with error:', error);
    process.exit(1);
  }
};

runPhase9Tests();
