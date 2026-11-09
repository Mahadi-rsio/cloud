#!/usr/bin/env bash
set -e

NAMESPACE="${1:-test_user}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo "  Multi-Tenant libSQL / SQLite ORM Verification Suite     "
echo "  Target Namespace: ${NAMESPACE}"
echo "=========================================================="

echo -e "\n1. Generating JWT token for namespace '${NAMESPACE}'..."
export DB_TOKEN=$(node "${DIR}/manage.js" token "${NAMESPACE}")
export DB_URL="http://${NAMESPACE}.localhost:8080"

echo "   Database URL:   ${DB_URL}"
echo "   Token Prefix:   ${DB_TOKEN:0:25}..."

echo -e "\n----------------------------------------------------------"
echo "2. Running Node.js ORMs (Drizzle ORM & Kysely)..."
echo "----------------------------------------------------------"
(cd "${DIR}/examples/nodejs" && node test_drizzle.mjs)
(cd "${DIR}/examples/nodejs" && node test_kysely.mjs)

echo -e "\n----------------------------------------------------------"
echo "3. Running Python ORMs & Drivers (libsql-client & SQLAlchemy)..."
echo "----------------------------------------------------------"
PYTHON_VENV="${DIR}/examples/python/venv/bin/python3"
if [ -f "$PYTHON_VENV" ]; then
  "$PYTHON_VENV" "${DIR}/examples/python/test_libsql_client.py"
  "$PYTHON_VENV" "${DIR}/examples/python/test_sqlalchemy.py"
else
  echo "Python venv not found at ${PYTHON_VENV}, skipping Python tests."
fi

echo -e "\n----------------------------------------------------------"
echo "4. Running Go ORMs & Drivers (database/sql & GORM)..."
echo "----------------------------------------------------------"
if command -v go >/dev/null 2>&1; then
  (cd "${DIR}/examples/go" && go run main.go)
  (cd "${DIR}/examples/go" && go run test_gorm.go)
else
  echo "Go not installed, skipping Go tests."
fi

echo -e "\n=========================================================="
echo "🎉 ALL ORM AND LANGUAGE TESTS COMPLETED SUCCESSFULLY!"
echo "=========================================================="
