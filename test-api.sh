#!/bin/bash
# Test with a public video (no cookies needed)
echo "=== Testing with public video ==="
curl -s -X POST http://localhost:3000/api/info \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' 2>&1
echo ""
