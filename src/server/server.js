/**
 * Description: Server logic for Evaluating Human-Centered XAI-Assisted Decision Making
 *
 * Author: V Natarjan
 */

const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// From server/server.js the project root is one level above
const project_root = "../";
const app = express();
const db_path = path.join(__dirname, project_root, 'database/database.db');
const PORT = process.env.PORT || 7000;
const client_ui_web_pages_location='client';
let db;

// Initialize the server and database
function init() {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, project_root, client_ui_web_pages_location)));
    db_init((err) => {
        if (err) {
            console.error("Failed to initialize database schema:", err.message);
            process.exitCode = 1;
            return;
        }
        start_http_server(PORT);
    });
}

function start_http_server(port) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}?participant_id=123&study_id=456`);
    });
}

function db_create_or_open()
{
    // Create or open the database
    db = new sqlite3.Database(db_path, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Database opened (or created if not existing) successfully.');
    }

    });

    //Other files can access it
    module.exports = db;
}

function db_table_init(on_complete)
{
    // Create table if it doesn't exist
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS participant_feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    participant_id TEXT NOT NULL,
                    study_id INTEGER NOT NULL,
                    xray_image TEXT NOT NULL,
                    participant_diagnosis TEXT NOT NULL,
                    page_nr INTEGER NOT NULL, 
                    created_at INTEGER DEFAULT (strftime('%s', 'now')), 
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )`
            );
    });
    // add trigger
    db.serialize(() => {
        db.run(`DROP TRIGGER IF EXISTS set_timestamp1;`);
        db.run(`CREATE TRIGGER set_timestamp1
                AFTER UPDATE ON participant_feedback
                FOR EACH ROW
                BEGIN
                    UPDATE participant_feedback
                    SET updated_at = (strftime('%s', 'now'))
                    WHERE id = OLD.id;
                END;`
            );
    });

    // Create table if it doesn't exist
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS access_times (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    participant_id TEXT NOT NULL,
                    study_id INTEGER NOT NULL,
                    page_nr INTEGER NOT NULL,
                    last_access_ms INTEGER NOT NULL,
                    last_update_ms INTEGER NOT NULL, 
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )`);
    });
    // add trigger
    db.serialize(() => {
        db.run(`DROP TRIGGER IF EXISTS set_timestamp2;`);
        db.run(`CREATE TRIGGER set_timestamp2
                AFTER UPDATE ON access_times
                FOR EACH ROW
                BEGIN
                    UPDATE access_times
                    SET updated_at = (strftime('%s', 'now'))
                    WHERE id = OLD.id;
                END;`
        );
    });

    db.run(`CREATE TABLE IF NOT EXISTS participant_chat_history (
                participant_id TEXT NOT NULL,
                study_id INTEGER NOT NULL,
                page_nr INTEGER NOT NULL,
                messages TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (participant_id, study_id, page_nr)
            )`,
        (err) => {
            if (err) {
                console.error("Error initializing participant_chat_history table:", err.message);
            }
            on_complete(err);
        }
    );
}

function db_init(on_complete)
{
    db_create_or_open();
    db_table_init(on_complete);
}

// Register a POST route
function register_post_event(route, callback) {
    app.post(route, (req, res) => {
        callback(req, res);
    });
}

// Register a GET route
function register_get_event(route, callback) {
    app.get(route, (req, res) => {
        callback(req, res);
    });
}

/* 1. Checks if an entry exists with the same participant_id, study_id, and page_nr
 * 2. If an entry exists  -> Updates participant_diagnosis and xray_image
 * 3. If no entry         -> Inserts a new record into the database
 */
function cb_event_write_db(req, res) {
    const { participant_id, study_id, xray_image, participant_diagnosis, page_nr } = req.body;

    console.log(`Checking database for existing entry: participant_id=${participant_id}, study_id=${study_id}, page_nr=${page_nr}`);

    const diagnosis_labels = {
        healthy: "Healthy",
        weak_spine: "Weak Spine",
        bone_degen: "Bone Degen",
        overbending: "Overbending",
        unhealthy: "OCDegen",
        ocdegen: "OCDegen"
    };
    const diagnosis_key = typeof participant_diagnosis === "string"
        ? participant_diagnosis.trim().toLowerCase().replace(/[\s-]+/g, "_")
        : "";
    const p_diagnosis = Object.prototype.hasOwnProperty.call(diagnosis_labels, diagnosis_key)
        ? diagnosis_labels[diagnosis_key]
        : null;

    if (!participant_id || !study_id || !xray_image || page_nr == null) {
        return res.status(400).json({ error: "Missing required feedback fields" });
    }
    if (!p_diagnosis) {
        return res.status(400).json({
            error: "Invalid diagnosis",
            allowed_diagnoses: ["healthy", "weak_spine", "bone_degen", "overbending"]
        });
    }

    // First, check if an entry already exists
    db.get(
        `SELECT * FROM participant_feedback WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
        [study_id, participant_id, page_nr],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }

            if (row) {
                // If entry exists, update it
                const oldDiagnosis = row.participant_diagnosis;
                if (oldDiagnosis === p_diagnosis && row.xray_image === xray_image) {
                    console.log("Diagnosis unchanged, skipping update.");
                    return res.json({ message: "Diagnosis unchanged, no update needed." });
                }

                db.run(
                    `UPDATE participant_feedback
                     SET participant_diagnosis = ?, xray_image = ?
                     WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                    [p_diagnosis, xray_image, study_id, participant_id, page_nr],
                    (updateErr) => {
                        if (updateErr) {
                            console.error(updateErr.message);
                            return res.status(500).send('Error updating data');
                        }

                        // update access_times, then send ONE response
                        db.run(
                            `UPDATE access_times
                             SET last_update_ms = CAST(strftime('%s','now') AS INTEGER)*1000
                             WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                            [study_id, participant_id, page_nr],
                            (err2) => {
                                if (err2) {
                                    console.error(err2.message);
                                    return res.status(500).send('Error updating access time');
                                }
                                return res.json({ message: "Data updated successfully!" });
                            }
                        );
                    }
                );
            } else {
                // If no existing entry, insert a new one
                db.run(
                    `INSERT INTO participant_feedback (participant_id, study_id, xray_image, participant_diagnosis, page_nr)
                     VALUES (?, ?, ?, ?, ?)`,
                    [participant_id, study_id, xray_image, p_diagnosis, page_nr],
                    (insertErr) => {
                        if (insertErr) {
                            console.error(insertErr.message);
                            return res.status(500).send('Error saving data');
                        }

                        // update access_times, then send ONE response
                        db.run(
                            `UPDATE access_times
                             SET last_update_ms = CAST(strftime('%s','now') AS INTEGER)*1000
                             WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                            [study_id, participant_id, page_nr],
                            (err2) => {
                                if (err2) {
                                    console.error(err2.message);
                                    return res.status(500).send('Error updating access time');
                                }
                                return res.json({ message: "Data stored successfully!" });
                            }
                        );
                    }
                );
            }
        }
    );
}

function cb_event_log_visit(req, res) {
    const { participant_id, study_id, page_nr } = req.body;

    console.log(`Logging page visit: participant_id=${participant_id}, study_id=${study_id}, page_nr=${page_nr}`);

    // Basic validation + single response path
    if (!participant_id || !study_id || page_nr == null) {
        return res.status(400).json({ error: 'missing fields' });
    }

    db.run(
        `INSERT INTO access_times
            (participant_id, study_id, page_nr, last_access_ms, last_update_ms)
            VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000)`,
        [participant_id, study_id, page_nr],
        function (err) {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'db insert failed' });
            }
            return res.json({ success: true, id: this.lastID });
        }
    );
};

function cb_event_write_chat_history(req, res) {
    const { participant_id, study_id, page_nr, messages } = req.body;
    const parsed_study_id = Number(study_id);
    const parsed_page_nr = Number(page_nr);

    if (
        typeof participant_id !== "string" ||
        participant_id.trim() === "" ||
        !Number.isInteger(parsed_study_id) ||
        parsed_study_id < 1 ||
        !Number.isInteger(parsed_page_nr) ||
        parsed_page_nr < 1 ||
        !Array.isArray(messages) ||
        messages.some(message =>
            !message ||
            !["user", "assistant"].includes(message.role) ||
            typeof message.content !== "string"
        )
    ) {
        return res.status(400).json({ error: "Invalid chat history fields" });
    }

    const serialized_messages = JSON.stringify(messages);
    db.run(
        `INSERT INTO participant_chat_history (participant_id, study_id, page_nr, messages)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (participant_id, study_id, page_nr)
         DO UPDATE SET messages = excluded.messages, updated_at = strftime('%s', 'now')`,
        [participant_id.trim(), parsed_study_id, parsed_page_nr, serialized_messages],
        (err) => {
            if (err) {
                console.error("Database error saving chat history:", err.message);
                return res.status(500).json({ error: "Error saving chat history" });
            }
            return res.json({ success: true });
        }
    );
}

function cb_event_read_chat_history(req, res) {
    const { participant_id, study_id, page_nr } = req.query;
    const parsed_study_id = Number(study_id);
    const parsed_page_nr = Number(page_nr);

    if (
        typeof participant_id !== "string" ||
        participant_id.trim() === "" ||
        !Number.isInteger(parsed_study_id) ||
        parsed_study_id < 1 ||
        !Number.isInteger(parsed_page_nr) ||
        parsed_page_nr < 1
    ) {
        return res.status(400).json({ error: "Invalid chat history fields" });
    }

    db.get(
        `SELECT messages FROM participant_chat_history
         WHERE participant_id = ? AND study_id = ? AND page_nr = ?`,
        [participant_id.trim(), parsed_study_id, parsed_page_nr],
        (err, row) => {
            if (err) {
                console.error("Database error reading chat history:", err.message);
                return res.status(500).json({ error: "Error reading chat history" });
            }
            if (!row) {
                return res.json({ messages: [] });
            }
            try {
                return res.json({ messages: JSON.parse(row.messages) });
            } catch (parse_error) {
                console.error("Invalid chat history stored in database:", parse_error);
                return res.status(500).json({ error: "Stored chat history is invalid" });
            }
        }
    );
}

function cb_event_read_db(req, res) {
    db.all(
        `SELECT participant_feedback.*,
                COALESCE(participant_chat_history.messages, '[]') AS chat_history
         FROM participant_feedback
         LEFT JOIN participant_chat_history
            ON participant_feedback.participant_id = participant_chat_history.participant_id
            AND participant_feedback.study_id = participant_chat_history.study_id
            AND participant_feedback.page_nr = participant_chat_history.page_nr`,
        [],
        (err, rows) => {
            if (err) {
                console.error("Database Error:", err);
                res.status(500).json({ error: "Error reading data" });
                return;
            }
            res.json(rows);
        }
    );
}

function cb_event_read_db_prev(req, res) {
    const { participant_id, study_id, page_nr } = req.query;

    console.log(`Checking database for existing entry: participant_id=${participant_id}, study_id=${study_id}, page_nr=${page_nr}`);
    const query = `SELECT * FROM participant_feedback WHERE participant_id = ? AND study_id = ? AND page_nr = ?`;

    const params = [participant_id, study_id, page_nr];

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error("Database Error:", err);
            res.status(500).json({ error: "Error reading data" });
            return;
        }
        console.error(rows);
        res.json(rows);
    });
}

function get_last_updated_page_nr(participant_id, study_id) {
    console.log(`Fetching last updated page_nr for: participant_id=${participant_id}, study_id=${study_id}`);

    const query = `SELECT MAX(page_nr) AS last_updated_page_nr FROM participant_feedback WHERE participant_id = ? AND study_id = ?`;

    return new Promise((resolve, reject) => {
        db.get(query, [participant_id, study_id], (err, row) => {
            if (err) {
                console.error("Database error: Fetching Last Updated Page Number", err);
                return reject(-1); // Handle DB error
            }
            resolve(row?.last_updated_page_nr ?? 1); // Default to 1 if no record found
        });
    });
}

function get_study_details(study_id) {
    console.log(`Fetching study details for: study_id=${study_id}`);

    const query = `SELECT study_id, study_type, total_pages FROM study WHERE study_id = ?`;

    return new Promise((resolve, reject) => {
        db.get(query, [study_id], (err, row) => {
            if (err) {
                console.error("Database error:", err);
                return reject({ study_type: -1, total_pages: -1 }); // Handle DB error
            }
            if (!row) {
                console.error(`Study table not created or record not available: ${row}`);
                return reject({ study_type: -2, total_pages: -2 }); // Handle missing record
            }
            const input_json_path = path.join(
                __dirname,
                project_root,
                client_ui_web_pages_location,
                `study_id_${study_id}`,
                'input.json'
            );
            fs.readFile(input_json_path, 'utf8', (read_err, contents) => {
                if (read_err) {
                    if (read_err.code === 'ENOENT') {
                        console.warn(`No input.json for study ${study_id}; using database page count.`);
                        return resolve({
                            study_type: parseInt(row.study_type),
                            total_pages: parseInt(row.total_pages)
                        });
                    }
                    console.error(`Failed to read study ${study_id} input.json:`, read_err);
                    return reject(read_err);
                }

                let study_data;
                try {
                    study_data = JSON.parse(contents);
                } catch (parse_err) {
                    console.error(`Invalid input.json for study ${study_id}:`, parse_err);
                    return reject(new Error(`Invalid input.json for study ${study_id}`));
                }
                if (!Array.isArray(study_data.PATIENT_ID) || study_data.PATIENT_ID.length === 0) {
                    const data_err = new Error(`input.json for study ${study_id} has no patient samples`);
                    console.error(data_err.message);
                    return reject(data_err);
                }

                const total_pages = study_data.PATIENT_ID.length;
                if (total_pages !== parseInt(row.total_pages)) {
                    console.warn(
                        `Study ${study_id} database page count (${row.total_pages}) differs from input.json (${total_pages}); using input.json.`
                    );
                    db.run(
                        `UPDATE study SET total_pages = ? WHERE study_id = ?`,
                        [total_pages, study_id],
                        (update_err) => {
                            if (update_err) {
                                console.error(`Failed to update page count for study ${study_id}:`, update_err);
                            }
                        }
                    );
                }
                resolve({ study_type: parseInt(row.study_type), total_pages });
            });
        });
    });
}

async function cb_event_db_validation_participant_id_and_study_id(req, res) {
    const { participant_id, study_id } = req.body; // Get both participant_id and study_id from the request body
    console.log(`[ CLIENT REQUEST ] Submit Participant ID: ${encodeURIComponent(participant_id)}`);
    console.log(`[ CLIENT REQUEST ] Submit Study ID: ${encodeURIComponent(study_id)}`);

    try {
        const { study_type, total_pages } = await get_study_details(parseInt(study_id));
        console.log(`Study Details: study_type=${study_type}, total_pages=${total_pages}`);

        if (study_type === -1) {
            return res.status(500).json({ error: "DB Error or study table does not exist" });
        } else if (study_type === -2) {
            return res.status(404).json({ error: "Record with study_id does not exist in the study table" });
        }

        const last_updated_page_nr = await get_last_updated_page_nr(participant_id, study_id);

        if (last_updated_page_nr === -1) {
            console.log("DB Error fetching last updated page number");
            last_updated_page_nr = 1;
        }

        res.json({ participant_id, study_id, study_type, last_updated_page_nr, total_pages });
    } catch (error) {
        console.error("Unexpected server error:", error);
        res.status(500).json({ error: "Unexpected server error" });
    }
}


/*
function cb_event_get_last_updated_page_nr(req, res) {
    const { participant_id, study_id } = req.query;

    console.log(`Fetching last updated page_nr for: participant_id=${participant_id}, study_id=${study_id}`);

    const query = `SELECT MAX(page_nr) AS last_updated_page_nr FROM participant_feedback WHERE participant_id = ? AND study_id = ?`;

    db.get(query, [participant_id, study_id], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Error retrieving last updated page number" });
        }
        res.json({ last_updated_page_nr: row?.last_updated_page_nr ?? 1 }); // Return last updated page or 1 if no records [ the study page starts with page 1]
    });
}
*/
/*
function cb_event_get_study_details(req, res) {
    const { study_id } = req.query;

    console.log(`Fetching study details for: study_id=${study_id}`);

    const query = `SELECT study_id, study_type, total_pages FROM study WHERE study_id = ?`;

    db.get(query, [study_id], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error retrieving study details" });
        }
        if (!row) {
            return res.status(404).json({ error: "Study table not created or record not available" });
        }
        res.json(row);
    });
}
*/

init();
register_post_event("/db_validation_participant_id_and_study_id", cb_event_db_validation_participant_id_and_study_id);
register_post_event("/write_db", cb_event_write_db);
register_post_event("/log_visit", cb_event_log_visit);
register_post_event("/write_chat_history", cb_event_write_chat_history);
register_get_event("/read_db", cb_event_read_db);
register_get_event("/read_db_prev", cb_event_read_db_prev);
register_get_event("/read_chat_history", cb_event_read_chat_history);
//register_get_event("/read_db_get_last_updated_page_nr", cb_event_get_last_updated_page_nr);
//register_get_event("/read_db_get_study_details", cb_event_get_study_details);
