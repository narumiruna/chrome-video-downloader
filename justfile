# Show available commands.
default:
    @just --list

# Install dependencies from the lockfile.
install:
    npm ci

# Run Extension.js with a fresh Chrome profile.
dev:
    npm run dev

# Build the Chrome production artifact and release zip.
build:
    npm run build:chrome

# Run unit and component tests once.
test:
    npm test

# Run extension end-to-end tests.
e2e:
    npm run test:e2e

# Check formatting and lint rules.
check:
    npm run check

# Apply Biome formatting and safe lint fixes.
fix:
    npm run fix

# Run TypeScript without emitting files.
typecheck:
    npm run typecheck

# Run the same checks used by CI and the pre-commit hook.
ci:
    npm run ci
