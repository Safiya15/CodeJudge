require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { connectDB, disconnectDB } = require('../config/db');
const { User, Problem, TestCase } = require('../models');

const seedProblems = async (customJsonPath = null) => {
  try {
    await connectDB();

    console.log('[Seeder] Starting problem & test case database seed...');

    // 1. Ensure an admin user exists to associate with created problems
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.log('[Seeder] Creating default administrator account (admin@codejudge.com)...');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('admin123', salt);
      admin = await User.create({
        name: 'System Admin',
        email: 'admin@codejudge.com',
        passwordHash,
        role: 'admin',
      });
      console.log('[Seeder] Admin account created: admin@codejudge.com / admin123');
    }

    // 2. Load JSON problems data
    const jsonPath =
      customJsonPath || path.join(__dirname, 'problems.json');
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Seed file not found at: ${jsonPath}`);
    }

    const rawData = fs.readFileSync(jsonPath, 'utf-8');
    const problemsData = JSON.parse(rawData);

    console.log(`[Seeder] Found ${problemsData.length} problems to import from ${jsonPath}`);

    let totalProblemsInserted = 0;
    let totalTestCasesInserted = 0;

    for (const item of problemsData) {
      // Remove existing problem with same slug if present to maintain idempotency
      const existing = await Problem.findOne({ slug: item.slug });
      if (existing) {
        await TestCase.deleteMany({ problemId: existing._id });
        await existing.deleteOne();
      }

      const problem = await Problem.create({
        title: item.title,
        slug: item.slug,
        statement: item.statement,
        difficulty: item.difficulty,
        tags: item.tags || [],
        timeLimitMs: item.timeLimitMs || 2000,
        memoryLimitMb: item.memoryLimitMb || 256,
        allowedLanguages: item.allowedLanguages || ['cpp', 'python', 'java', 'javascript'],
        createdBy: admin._id,
      });

      totalProblemsInserted++;

      if (Array.isArray(item.testCases) && item.testCases.length > 0) {
        const testCasesToInsert = item.testCases.map((tc, idx) => ({
          problemId: problem._id,
          input: tc.input || '',
          expectedOutput: tc.expectedOutput,
          isHidden: !!tc.isHidden,
          order: tc.order != null ? tc.order : idx + 1,
        }));

        await TestCase.insertMany(testCasesToInsert);
        totalTestCasesInserted += testCasesToInsert.length;
      }
    }

    console.log(`[Seeder] Successfully imported ${totalProblemsInserted} problems and ${totalTestCasesInserted} test cases!`);
  } catch (err) {
    console.error(`[Seeder] Seed failed: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
};

// Check if running via CLI
if (require.main === module) {
  const customFile = process.argv[2] || null;
  seedProblems(customFile);
}

module.exports = { seedProblems };
