#!/bin/bash

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Strip git global options so "git -C <path> push" matches the same patterns as "git push".
COMMAND=$(printf '%s' "$COMMAND" | sed -E 's/-C[[:space:]]+("[^"]*"|[^[:space:]]+)//g; s/-c[[:space:]]+("[^"]*"|[^[:space:]]+)//g; s/[[:space:]]+/ /g')

DANGEROUS_PATTERNS=(
  "git push"
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
