"""
Description: Initialize the database and create required tables if they do not exist.

Author: V Natarjan
"""

import sqlite3
import os

def create_database():
    db_path = "database/database.db"
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS participant_chat_history (
            participant_id TEXT NOT NULL,
            study_id INTEGER NOT NULL,
            page_nr INTEGER NOT NULL,
            messages TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (participant_id, study_id, page_nr)
        )
    ''')

    # cursor.execute('''
    #     CREATE TABLE IF NOT EXISTS participant_feedback (
    #         id INTEGER PRIMARY KEY AUTOINCREMENT,
    #         participant_id TEXT NOT NULL,
    #         study_id INTEGER NOT NULL,
    #         xray_image TEXT NOT NULL,
    #         participant_diagnosis TEXT NOT NULL,
    #         page_nr INTEGER NOT NULL
    #     )
    # ''')

    # cursor.execute('''
    #     CREATE TABLE IF NOT EXISTS study (
    #         study_id INTEGER PRIMARY KEY,
    #         study_type INTEGER CHECK(study_type IN (1, 2, 3, 4, 5)),
    #         total_pages INTEGER
    #     )
    # ''')

    conn.commit()
    conn.close()
    print("Database and tables created successfully.")

def main():
    create_database()

main()
