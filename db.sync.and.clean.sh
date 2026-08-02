#!/usr/bin/env bash
#
# Description: 1) Syncs study.total_pages in the DB with the actual number of
#                 entries in each study's input.json (fixes the total_pages
#                 mismatch bug).
#              2) Finds/removes orphaned participant_feedback + access_times
#                 rows: rows for a study_id that no longer exists in the
#                 study table, and rows whose page_nr exceeds the study's
#                 current total_pages (fixes the "resumes at page 20" bug).
#
# Run this from the project root (same level as database/ and src/).
#
# Usage:
#   ./db.sync.and.clean.sh            # dry run - only reports findings
#   ./db.sync.and.clean.sh --apply    # actually applies the fixes
#
# Author: (generated with Claude)

set -euo pipefail

DB="database/database.db"
CLIENT_DIR="src/client"
APPLY=0

if [[ "${1:-}" == "--apply" ]]; then
    APPLY=1
fi

if [[ ! -f "$DB" ]]; then
    echo "Database not found at $DB — run this script from the project root."
    exit 1
fi

echo "== Step 1: Checking total_pages vs input.json for each study =="

declare -A CORRECT_TOTAL   # study_id -> correct total_pages, derived from input.json

while IFS='|' read -r study_id db_total_pages; do
    [[ -z "$study_id" ]] && continue
    input_json="$CLIENT_DIR/study_id_${study_id}/input.json"

    if [[ ! -f "$input_json" ]]; then
        echo "  [WARN] study_id=$study_id: no input.json found at $input_json, skipping."
        continue
    fi

    actual_pages=$(python3 -c "
import json
with open('$input_json') as f:
    data = json.load(f)
print(len(data.get('PATIENT_ID', [])))
")

    # Remember the correct value for every study so Step 2 can check
    # against it, regardless of whether the DB has been fixed yet.
    CORRECT_TOTAL["$study_id"]="$actual_pages"

    if [[ "$actual_pages" != "$db_total_pages" ]]; then
        echo "  [MISMATCH] study_id=$study_id: DB total_pages=$db_total_pages, input.json has $actual_pages entries."
        if [[ $APPLY -eq 1 ]]; then
            sqlite3 "$DB" "UPDATE study SET total_pages = $actual_pages WHERE study_id = $study_id;"
            echo "    -> updated to $actual_pages"
        fi
    else
        echo "  [OK] study_id=$study_id: total_pages=$db_total_pages matches input.json."
    fi
done < <(sqlite3 "$DB" "SELECT study_id, total_pages FROM study;")

echo ""
echo "== Step 2: Checking for orphaned participant_feedback / access_times rows =="

echo "-- Rows referencing a study_id that no longer exists in the study table --"
sqlite3 "$DB" "
SELECT DISTINCT study_id FROM participant_feedback WHERE study_id NOT IN (SELECT study_id FROM study)
UNION
SELECT DISTINCT study_id FROM access_times WHERE study_id NOT IN (SELECT study_id FROM study);
" | while read -r sid; do
    [[ -z "$sid" ]] && continue
    count_fb=$(sqlite3 "$DB" "SELECT COUNT(*) FROM participant_feedback WHERE study_id = $sid;")
    count_at=$(sqlite3 "$DB" "SELECT COUNT(*) FROM access_times WHERE study_id = $sid;")
    echo "  [ORPHAN STUDY] study_id=$sid: $count_fb participant_feedback rows, $count_at access_times rows."
    if [[ $APPLY -eq 1 ]]; then
        sqlite3 "$DB" "DELETE FROM participant_feedback WHERE study_id = $sid;"
        sqlite3 "$DB" "DELETE FROM access_times WHERE study_id = $sid;"
        echo "    -> deleted"
    fi
done

echo "-- Rows whose page_nr exceeds the study's CORRECT total_pages (input.json-derived, not the possibly-stale DB value) --"
sqlite3 "$DB" "
SELECT DISTINCT pf.study_id, pf.participant_id, pf.page_nr FROM participant_feedback pf
UNION
SELECT DISTINCT at.study_id, at.participant_id, at.page_nr FROM access_times at;
" | while IFS='|' read -r sid pid pnr; do
    [[ -z "$sid" ]] && continue
    correct="${CORRECT_TOTAL[$sid]:-}"
    # No input.json for this study (already warned about in Step 1) -> can't judge, skip.
    [[ -z "$correct" ]] && continue

    if (( pnr > correct )); then
        echo "  [STALE] study_id=$sid participant_id=$pid page_nr=$pnr exceeds correct total_pages=$correct."
        if [[ $APPLY -eq 1 ]]; then
            sqlite3 "$DB" "DELETE FROM participant_feedback WHERE study_id = $sid AND participant_id = '$pid' AND page_nr = $pnr;"
            sqlite3 "$DB" "DELETE FROM access_times WHERE study_id = $sid AND participant_id = '$pid' AND page_nr = $pnr;"
            echo "    -> deleted"
        fi
    fi
done

echo ""
if [[ $APPLY -eq 0 ]]; then
    echo "Dry run complete. Re-run with --apply to actually fix the DB."
else
    echo "Fixes applied."
fi
