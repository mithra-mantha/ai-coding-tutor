from flask import Flask, render_template, request, jsonify
from google import genai
from werkzeug.exceptions import BadRequest

import sqlite3
app = Flask(__name__)

DB_FILE = "database.db"
# I use gemini, because it's free!
client = genai.Client()
# Honestly, writing a huge boilerplate just to execute a simple sql query is annoying.
# That's why I wrote these functions.
def sql_query(query, placeholders=None):
    """SQLite function that is for queries that return something."""
    with sqlite3.connect(DB_FILE) as connection:
        cursor = connection.cursor()
        if placeholders:
            cursor.execute(query, placeholders)
        else:
            cursor.execute(query)
        connection.commit()
        return cursor.fetchall()
def sql_modify(query, placeholders=None):
    """SQLite function that is for queries that do not return something."""
    with sqlite3.connect(DB_FILE) as connection:
        cursor = connection.cursor()
        if placeholders:
            cursor.execute(query, placeholders)
        else:
            cursor.execute(query)
        connection.commit()
@app.route("/")
def index_render():
    return render_template("index.html")
@app.route("/api/create-chat", methods=["POST"])
def create_chat():
    # sql_modify("CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, conversation_id TEXT);") # The conversation_id is the code that Gemini assigns this particular conversation.
    print("Waiting for ai response...")
    data = request.get_json()
    conversation = client.interactions.create(
        model="gemini-3.5-flash-lite",
        input=data.get("message")
    )
    print("Done!")
    return {"message":conversation.output_text, "id":conversation.id}
@app.route("/api/chat", methods=["POST"])
def chat():
    print("Waiting for ai response...")
    data = request.get_json()
    message = data.get("message")
    conversation_id = data.get("id")
    conversation = client.interactions.create(
        model="gemini-3.7-flash",
        input=message,
        previous_interaction_id=conversation_id
    )
    print("Done!")
    return {"message":conversation.output_text, "id":conversation_id}
@app.errorhandler(BadRequest)
def bad_request_handler(event):
    print("HTTP ERROR 400!!!")
    print("Error description: " + event.description)
    return jsonify(error=event.description), 400
if __name__ == "__main__":
    app.run(debug=True)