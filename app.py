from flask import Flask, render_template, request, jsonify, url_for
from google import genai
from werkzeug.exceptions import BadRequest
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_mailman import Mail, EmailMultiAlternatives
import sqlite3
import secrets
import os
app = Flask(__name__)
# Fetch the environment variables
# There is already a library for this called dotenv, but why install a library when I can replace it with 5 lines of code?
with open(".env", "r") as file:
    for line in file:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        os.environ[key.strip()] = value.strip()
app.secret_key = os.getenv("SECRET_KEY")

DB_FILE = "database.db"
client = genai.Client()
# Set up Flask-Login stuff
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login_render"
class User(UserMixin):
    def __init__(self, id, email):
        self.id = id
        self.email = email
@login_manager.user_loader
def load_user(user_id):
    email = sql_query("SELECT email FROM users WHERE id = ?", (user_id,))[0][0]
    return User(user_id, email)
# Set up Flask-Mailman stuff
app.config["MAIL_SERVER"] = "smtp-relay.brevo.com"
app.config["MAIL_PORT"] = 587
app.config["MAIL_USE_TLS"] = True
app.config["MAIL_USE_SSL"] = False
app.config["MAIL_USERNAME"] = "b7ef51001@smtp-brevo.com"
app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD")
mail = Mail(app)
@app.route("/")
def index_render():
    return render_template("index.html")
@app.route("/code")
@login_required
def code_render():
    return render_template("code.html")
@app.route("/login")
def login_render():
    return render_template("login.html", mode="login")
@app.route("/register")
def register_render():
    return render_template("login.html", mode="register")

@app.route("/api/create-chat", methods=["POST"])
def create_chat():
    print("Waiting for ai response...")
    data = request.get_json()
    conversation = client.interactions.create(
        model="gemini-3.5-flash-lite",
        input=data.get("message")
    )
    print("Done!")
    return jsonify({"message":conversation.output_text, "id":conversation.id})
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
    return jsonify({"message":conversation.output_text, "id":conversation_id})
@app.route("/api/login/check-email", methods=["POST"])
def login_check_email():
    return check_email()
@app.route("/api/register/check-email", methods=["POST"])
def register_check_email():
    return check_email(True)
def check_email(is_registering=False):
    data = request.get_json()
    email = data.get("email")
    # First let's check if their email already exists.
    email_exists = sql_query("SELECT email FROM users WHERE email = ?", (email,))
    if not is_registering and not email_exists:
        # They don't exist in the database, so register them.
        return jsonify({"warning":f"Your account doesn't exist. If you would like to create an account instead, go <a href='{url_for("register_render")}'>here</a>."})
    elif is_registering and email_exists:
        # They already exist, why do they need to sign up?
        return jsonify({"warning":f"Your account already exists. If you want to log in instead, go <a href='{url_for("login_render")}'>here</a>."})
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    msg = EmailMultiAlternatives(
        subject="Your code has arrived!",
        body=f"Your code is:\n{code}", # If the html thing fails they get the code anyway, for older/niche systems
        from_email=f"AI Coding Tutor <llvm.mantha@outlook.com>",
        to=(email,),
    )
    # And the html!
    msg.attach_alternative(render_template("code_email.html", code=code), "text/html")
    msg.send()
    # If a code already exists for their email, replace it with another one. Else, insert it normally
    sql_modify("INSERT OR REPLACE INTO codes (email, hashed_code) VALUES (?, ?)", (email, generate_password_hash(code)))
    return jsonify({"redirect":False}), 200
@app.route("/api/login/check-code", methods=["POST"])
def login_check_code():
    data = request.get_json()
    email = data.get("email")
    user_code = data.get("code")
    sent_code = sql_query("SELECT hashed_code FROM codes WHERE email = ?", (email,))[0][0]
    if check_password_hash(sent_code, user_code):
        user_id = sql_query("SELECT id FROM users WHERE email = ?", (email,))[0][0]
        login_user(User(user_id, email))
        return jsonify({"redirect": True, "link": url_for("code_render")})
    else:
        return jsonify({"code-wrong":True})
@app.route("/api/register/check-code", methods=["POST"])
def register_check_code():
    data = request.get_json()
    email = data.get("email")
    user_code = data.get("code")
    sent_code = sql_query("SELECT hashed_code FROM codes WHERE email = ?", (email,))[0][0]
    if check_password_hash(sent_code, user_code):
        # This is one case where I can't use the helper function because I need the user id too
        with sqlite3.connect(DB_FILE) as connection:
            cursor = connection.cursor()
            try:
                cursor.execute("INSERT INTO users (email) VALUES (?)", (email,))
                user_id = cursor.lastrowid
            except sqlite3.IntegrityError as error:
                # This means that clearly someone accidentally signed up instead of logging in, but let's log them in anyway
                # This is technically prevented in the check_email part but just in case...
                user_id = sql_query("SELECT id FROM users WHERE email = ?", (email,))[0][0]
        login_user(User(user_id, email))
        return jsonify({"redirect": True, "link": url_for("code_render")})
    else:
        return jsonify({"code-wrong":True})
@app.errorhandler(BadRequest)
def bad_request_handler(event):
    print("HTTP ERROR 400!!!")
    print("Error description: " + event.description)
    return jsonify(error=event.description), 400
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
sql_modify("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE)")
sql_modify("CREATE TABLE IF NOT EXISTS codes (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, hashed_code TEXT)")
if __name__ == "__main__":
    app.run(debug=True)
