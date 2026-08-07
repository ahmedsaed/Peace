// Silence the reanimated warning about missing native module under Jest.
global.__reanimatedWorkletInit = () => {};

// expo-sqlite has no JS implementation under Node; unit tests should exercise
// pure logic (src/lib) and components, and leave real DB behaviour to E2E.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getAllSync: jest.fn(() => []),
  }),
}));
