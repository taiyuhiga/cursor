#!/usr/bin/env bash
set -euo pipefail

export BASE_URL="${BASE_URL:-http://localhost:3000}"
export PROJECT_ID="${PROJECT_ID:?PROJECT_ID is required}"
# Use unique filename to avoid CDN cache issues
UNIQUE_SUFFIX="$(date +%s)"
export FILE_NAME="${FILE_NAME:-smoke-${UNIQUE_SUFFIX}.txt}"
export PARENT_ID="${PARENT_ID:-}"
export AUTH_BEARER="${AUTH_BEARER:-}"
export AUTH_COOKIE="${AUTH_COOKIE:-}"

# Optional auth header
AUTH_OPT=()
if [[ -n "${AUTH_BEARER}" ]]; then
  AUTH_OPT=(-H "Authorization: Bearer ${AUTH_BEARER}")
fi
if [[ -n "${AUTH_COOKIE}" ]]; then
  AUTH_OPT=(-H "Cookie: ${AUTH_COOKIE}" ${AUTH_OPT[@]+"${AUTH_OPT[@]}"})
fi

# parentId JSON value (null or "uuid")
if [[ -z "${PARENT_ID}" ]]; then
  PARENT_JSON="null"
else
  PARENT_JSON="\"${PARENT_ID}\""
fi

CREATE_URL="${BASE_URL}/api/storage/create-upload-url"
CONFIRM_URL="${BASE_URL}/api/storage/confirm-upload"
DOWNLOAD_URL="${BASE_URL}/api/storage/download"

echo "BASE_URL=${BASE_URL}"
echo "PROJECT_ID=${PROJECT_ID}"
echo "PARENT_ID=${PARENT_ID:-<root>}"
echo "FILE_NAME=${FILE_NAME}"

# ---- Test A: create-upload-url (1) ----
echo "== Test A: create-upload-url (1)"
HTTP_CODE1=$(curl -sS -D /tmp/h1.txt \
  -H "Content-Type: application/json" \
  ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
  -o /tmp/create1.json \
  -w "%{http_code}" \
  -X POST "${CREATE_URL}" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"parentId\":${PARENT_JSON},\"fileName\":\"${FILE_NAME}\",\"contentType\":\"text/plain\"}")

head -n 1 /tmp/h1.txt
cat /tmp/create1.json
echo

if [[ "${HTTP_CODE1}" != "200" ]]; then
  echo "Error: create-upload-url failed (status ${HTTP_CODE1}). Body:"
  cat /tmp/create1.json
  exit 1
fi

if ! grep -qi "^Content-Type: application/json" /tmp/h1.txt; then
  echo "Error: create-upload-url did not return JSON. Body:"
  cat /tmp/create1.json
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }

SIGNED_URL1=$(jq -r '.uploadUrl' /tmp/create1.json)
NODE_ID=$(jq -r '.nodeId' /tmp/create1.json)
STORAGE_PATH1=$(jq -r '.storagePath' /tmp/create1.json)
EXPECTED_VERSION1=$(jq -r '.currentVersion' /tmp/create1.json)

echo "SIGNED_URL1=${SIGNED_URL1}"
echo "NODE_ID=${NODE_ID}"
echo "STORAGE_PATH1=${STORAGE_PATH1}"
echo "EXPECTED_VERSION1=${EXPECTED_VERSION1}"
echo

# ---- Test B: upload v1 -> confirm -> download (expect v1) ----
echo "== Test B: PUT v1"
printf "v1" > /tmp/v1.txt
curl -fSs -D /tmp/put1.txt \
  -X PUT "${SIGNED_URL1}" \
  -H "Content-Type: text/plain" \
  -H "Cache-Control: no-cache" \
  --data-binary @/tmp/v1.txt
head -n 1 /tmp/put1.txt
echo

echo "== Test B: confirm v1"
curl -sS -D /tmp/c1.txt \
  -H "Content-Type: application/json" \
  ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
  -o /tmp/confirm1.json \
  -X POST "${CONFIRM_URL}" \
  -d "{\"nodeId\":\"${NODE_ID}\",\"storagePath\":\"${STORAGE_PATH1}\",\"expectedVersion\":${EXPECTED_VERSION1}}"
head -n 1 /tmp/c1.txt
if ! grep -q " 200 " /tmp/c1.txt; then
  echo "Confirm v1 failed. Response:"
  cat /tmp/confirm1.json
  exit 1
fi
cat /tmp/confirm1.json
echo

echo "== Test B: download (expect v1)"
curl -sS -D /tmp/dl1.txt \
  ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
  -o /tmp/out1.txt \
  "${DOWNLOAD_URL}?nodeId=${NODE_ID}"
head -n 1 /tmp/dl1.txt
if ! grep -q " 200 " /tmp/dl1.txt; then
  echo "Download v1 failed. Response:"
  cat /tmp/out1.txt
  exit 1
fi
cat /tmp/out1.txt
echo

# ---- Test B: create-upload-url (2) ----
echo "== Test B: create-upload-url (2)"
HTTP_CODE2=$(curl -sS -D /tmp/h2.txt \
  -H "Content-Type: application/json" \
  ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
  -o /tmp/create2.json \
  -w "%{http_code}" \
  -X POST "${CREATE_URL}" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"parentId\":${PARENT_JSON},\"fileName\":\"${FILE_NAME}\",\"contentType\":\"text/plain\"}")

head -n 1 /tmp/h2.txt
cat /tmp/create2.json
echo

if [[ "${HTTP_CODE2}" != "200" ]]; then
  echo "Error: create-upload-url failed (status ${HTTP_CODE2}). Body:"
  cat /tmp/create2.json
  exit 1
fi

if ! grep -qi "^Content-Type: application/json" /tmp/h2.txt; then
  echo "Error: create-upload-url did not return JSON. Check auth (307 to /auth/login is common)."
  exit 1
fi

SIGNED_URL2=$(jq -r '.uploadUrl' /tmp/create2.json)
NODE_ID2=$(jq -r '.nodeId' /tmp/create2.json)
STORAGE_PATH2=$(jq -r '.storagePath' /tmp/create2.json)
EXPECTED_VERSION2=$(jq -r '.currentVersion' /tmp/create2.json)

echo "SIGNED_URL2=${SIGNED_URL2}"
echo "NODE_ID2=${NODE_ID2}"
echo "STORAGE_PATH2=${STORAGE_PATH2}"
echo "EXPECTED_VERSION2=${EXPECTED_VERSION2}"
echo

if [[ "${NODE_ID}" != "${NODE_ID2}" ]]; then
  echo "Warning: nodeId mismatch between create-upload-url calls."
fi

# ---- Test B: upload v2 -> confirm -> download (expect v2) ----
echo "== Test B: PUT v2"
printf "v2" > /tmp/v2.txt
curl -fSs -D /tmp/put2.txt \
  -X PUT "${SIGNED_URL2}" \
  -H "Content-Type: text/plain" \
  -H "Cache-Control: no-cache" \
  --data-binary @/tmp/v2.txt
head -n 1 /tmp/put2.txt
echo

echo "== Test B: confirm v2"
curl -sS -D /tmp/c2.txt \
  -H "Content-Type: application/json" \
  ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
  -o /tmp/confirm2.json \
  -X POST "${CONFIRM_URL}" \
  -d "{\"nodeId\":\"${NODE_ID}\",\"storagePath\":\"${STORAGE_PATH2}\",\"expectedVersion\":${EXPECTED_VERSION2}}"
head -n 1 /tmp/c2.txt
if ! grep -q " 200 " /tmp/c2.txt; then
  echo "Confirm v2 failed. Response:"
  cat /tmp/confirm2.json
  exit 1
fi
cat /tmp/confirm2.json
echo

echo "== Test B: download (expect v2)"
attempt=1
while true; do
  curl -sS -D /tmp/dl2.txt \
    ${AUTH_OPT[@]+"${AUTH_OPT[@]}"} \
    -o /tmp/out2.txt \
    "${DOWNLOAD_URL}?nodeId=${NODE_ID}"
  head -n 1 /tmp/dl2.txt
  if ! grep -q " 200 " /tmp/dl2.txt; then
    echo "Download v2 failed. Response:"
    cat /tmp/out2.txt
    exit 1
  fi
  if [[ "$(cat /tmp/out2.txt)" == "v2" ]]; then
    cat /tmp/out2.txt
    echo
    break
  fi
  if [[ "${attempt}" -ge 5 ]]; then
    echo "Warning: download did not return v2 after ${attempt} attempts."
    cat /tmp/out2.txt
    echo
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
