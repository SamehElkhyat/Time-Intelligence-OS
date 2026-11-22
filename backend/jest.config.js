/** @type {import('jest').Config} */
const base = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true, diagnostics: false }],
  },
};

module.exports = {
  collectCoverageFrom: ['src/**/domain/**/*.ts', 'src/common/time/**/*.ts'],
  coverageDirectory: 'coverage',
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/tests/unit/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
      globalSetup: '<rootDir>/tests/integration/global-setup.ts',
      setupFiles: ['<rootDir>/tests/integration/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/tests/integration/setup-after-env.ts'],
    },
  ],
};
