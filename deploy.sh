#!/bin/bash

set -Eeuo pipefail

# ==========================================
# CONFIG
# ==========================================

NOTIFIER="http://127.0.0.1:3030/notify"
WA_NUMBER="6285793822395"

PROJECT="Restaurant-Caffe"
BRANCH="main"

LOG_FILE="/tmp/deploy-${PROJECT}.log"
ERROR_FILE="/tmp/deploy-${PROJECT}-error.log"

START_TIME=$(date +%s)
CURRENT_STEP="Memulai deployment"

# ==========================================
# WHATSAPP
# ==========================================

notify() {
    local message="$1"

    curl -s -X POST "$NOTIFIER" \
        -H "Content-Type: application/json" \
        -d "$(node -e '
            console.log(JSON.stringify({
                to: process.argv[1],
                message: process.argv[2]
            }))
        ' "$WA_NUMBER" "$message")" \
        >/dev/null 2>&1 || true
}

# ==========================================
# DURATION
# ==========================================

duration() {
    local now
    now=$(date +%s)

    echo "$((now - START_TIME))s"
}

# ==========================================
# COMMIT
# ==========================================

commit_hash() {
    git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

# ==========================================
# ERROR ANALYZER
# ==========================================

analyze_error() {

    local error="$1"

    echo "$error" > "$ERROR_FILE"

    # -------------------------------
    # Detect file + line
    # -------------------------------

    FILE_LINE=$(echo "$error" | grep -Eo \
        '(\./)?[^[:space:]]+\.(ts|tsx|js|jsx|json|css):[0-9]+(:[0-9]+)?' \
        | head -1 || true)

    # -------------------------------
    # Detect error type
    # -------------------------------

    ERROR_TYPE="Unknown"

    if echo "$error" | grep -qi "Type error"; then
        ERROR_TYPE="TypeScript"

    elif echo "$error" | grep -qi "Module not found"; then
        ERROR_TYPE="Module Not Found"

    elif echo "$error" | grep -qi "Cannot find module"; then
        ERROR_TYPE="Missing Module"

    elif echo "$error" | grep -qi "Prisma"; then
        ERROR_TYPE="Prisma"

    elif echo "$error" | grep -qi "migration"; then
        ERROR_TYPE="Database Migration"

    elif echo "$error" | grep -qi "Node.js"; then
        ERROR_TYPE="Node.js Version"

    elif echo "$error" | grep -qi "npm ERR"; then
        ERROR_TYPE="NPM"

    elif echo "$error" | grep -qi "permission denied"; then
        ERROR_TYPE="Permission"

    elif echo "$error" | grep -qi "ECONNREFUSED"; then
        ERROR_TYPE="Connection Refused"

    elif echo "$error" | grep -qi "DATABASE"; then
        ERROR_TYPE="Database"

    elif echo "$error" | grep -qi "Environment"; then
        ERROR_TYPE="Environment Variable"

    elif echo "$error" | grep -qi "ESLint"; then
        ERROR_TYPE="ESLint"
    fi

    # -------------------------------
    # Extract useful error lines
    # -------------------------------

    ERROR_DETAIL=$(echo "$error" \
        | grep -Ei \
        'error:|error |failed|fatal:|exception|cannot|cannot find|module not found|type error|npm ERR|P[0-9]{4}|permission denied|ECONNREFUSED|requires Node|syntax error' \
        | tail -12 \
        | sed 's/\x1b\[[0-9;]*m//g' \
        | head -12)

    if [ -z "$ERROR_DETAIL" ]; then
        ERROR_DETAIL=$(echo "$error" \
            | tail -15 \
            | sed 's/\x1b\[[0-9;]*m//g')
    fi

    # -------------------------------
    # Build WhatsApp message
    # -------------------------------

    MESSAGE="🚨 DEPLOYMENT FAILED

📦 Project:
$PROJECT

📍 Step:
$CURRENT_STEP

🧩 Error Type:
$ERROR_TYPE"

    if [ -n "$FILE_LINE" ]; then
        MESSAGE="$MESSAGE

📄 File:
$FILE_LINE"
    fi

    MESSAGE="$MESSAGE

💥 Error:
$ERROR_DETAIL

🔖 Commit:
$(commit_hash)

🖥 Node:
$(node -v)

⏱ Duration:
$(duration)

🛑 Deployment dihentikan."

    notify "$MESSAGE"
}

# ==========================================
# ERROR HANDLER
# ==========================================

on_error() {

    EXIT_CODE=$?

    echo ""
    echo "======================================"
    echo "DEPLOYMENT FAILED"
    echo "======================================"
    echo "Step: $CURRENT_STEP"
    echo "Exit code: $EXIT_CODE"

    ERROR_OUTPUT=$(tail -100 "$ERROR_FILE" 2>/dev/null || true)

    analyze_error "$ERROR_OUTPUT"

    exit "$EXIT_CODE"
}

trap on_error ERR

# ==========================================
# COMMAND RUNNER
# ==========================================

run_step() {

    local step_name="$1"
    shift

    CURRENT_STEP="$step_name"

    echo ""
    echo "======================================"
    echo "$step_name"
    echo "======================================"

    : > "$ERROR_FILE"

    if "$@" > >(tee -a "$LOG_FILE") 2> >(tee -a "$ERROR_FILE" >&2); then
        return 0
    else
        return 1
    fi
}

# ==========================================
# START DEPLOYMENT
# ==========================================

notify "🚀 DEPLOYMENT STARTED

📦 $PROJECT
🌿 Branch: $BRANCH

🔖 Commit:
$(commit_hash)

🖥 Node:
$(node -v)

⏳ Memulai deployment..."

# ==========================================
# 1. UPDATE SOURCE
# ==========================================

notify "⏳ [1/6] Update source code..."

run_step "[1/6] Update source code" bash -c '
    git fetch origin
    git reset --hard origin/main
'

notify "✅ [1/6] Source code berhasil diperbarui"

# ==========================================
# 2. NPM CI
# ==========================================

notify "⏳ [2/6] Install dependencies..."

run_step "[2/6] Install dependencies" npm ci

notify "✅ [2/6] Dependencies berhasil diinstall"

# ==========================================
# 3. PRISMA GENERATE
# ==========================================

notify "⏳ [3/6] Prisma generate..."

run_step "[3/6] Prisma generate" npx prisma generate

notify "✅ [3/6] Prisma generate berhasil"

# ==========================================
# 4. PRISMA MIGRATION
# ==========================================

notify "⏳ [4/6] Prisma migration..."

run_step "[4/6] Prisma migration" npx prisma migrate deploy

notify "✅ [4/6] Prisma migration berhasil"

# ==========================================
# 5. BUILD
# ==========================================

notify "⏳ [5/6] Build application..."

run_step "[5/6] Build application" npm run build

notify "✅ [5/6] Build berhasil"

# ==========================================
# 6. PM2
# ==========================================

notify "⏳ [6/6] Restart PM2 toko..."

run_step "[6/6] Restart PM2" pm2 reload toko

notify "✅ [6/6] PM2 toko berhasil direload"

# ==========================================
# SUCCESS
# ==========================================

notify "🎉 DEPLOYMENT SUCCESS

📦 Project:
$PROJECT

🌿 Branch:
$BRANCH

✅ Source updated
✅ Dependencies installed
✅ Prisma generated
✅ Migration completed
✅ Build successful
✅ PM2 restarted

🚀 Application:
ONLINE

🔖 Commit:
$(commit_hash)

⏱ Duration:
$(duration)"

echo ""
echo "======================================"
echo "🎉 DEPLOY SUCCESS"
echo "======================================"
