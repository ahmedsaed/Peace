/// <reference types="expo/types" />
/// <reference types="nativewind/types" />

// Committed on purpose.
//
// Expo generates `expo-env.d.ts` with the same `expo/types` reference, but that
// file is gitignored — so a fresh checkout (CI, or a new clone) has no ambient
// declarations and `tsc` fails on things like `import '@/global.css'`. Keeping
// our own reference here means typecheck does not depend on a generated file
// that is not in the repository.
