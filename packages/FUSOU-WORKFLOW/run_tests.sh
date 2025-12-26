#!/bin/bash

echo "==============================================="
echo "FUSOU-WORKFLOW - Complete Test Suite"
echo "==============================================="
echo

cd /home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-WORKFLOW

# Compile first
npx tsc --outDir dist 2>&1 > /dev/null

# Core tests
tests=(
  "run-avro-tests.mjs"
  "test_producer.mjs"
  "test_consumer.mjs"
  "test-multiblock-end-to-end.mjs"
  "test-error-handling.mjs"
  "test-comprehensive.mjs"
  "test-hot-cold-simple.mjs"
  "test-avro-deflate-roundtrip.mjs"
  "test-schema-namespace-fingerprint.mjs"
  "test-codec-mismatch.mjs"
  "test-production-validation.mjs"
)

passed=0
failed=0

for test in "${tests[@]}"; do
  echo "Running: $test..."
  if timeout 20 node "test/$test" > /dev/null 2>&1; then
    echo "  ✅ PASSED"
    ((passed++))
  else
    echo "  ❌ FAILED"
    ((failed++))
  fi
done

echo
echo "==============================================="
echo "Final Results: $passed passed, $failed failed"
echo "==============================================="

if [ $failed -eq 0 ]; then
  echo "✨ ALL TESTS PASSED!"
  exit 0
else
  exit 1
fi
