#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <filename>"
  exit 1
fi

file="$1"

if [ ! -f "$file" ]; then
  echo "Error: File '$file' not found."
  exit 1
fi

sed -i 's/bigint/number/g' "$file"

echo "Replaced all occurrences of 'bigint' with 'number' in file '$file'."