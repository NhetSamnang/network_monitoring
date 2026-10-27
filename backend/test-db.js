
require("dotenv").config();

const mysql = require("mysql2/promise");

async function testConnection() {
  let connection;

  try {
    console.log("Checking MySQL connection...");

    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "network_monitoring",
    });

    console.log("MySQL connected successfully!");

    const [rows] = await connection.query(
      "SELECT DATABASE() AS databaseName"
    );

    console.log("Database:", rows[0].databaseName);
  } catch (error) {
    console.error("MySQL connection failed:");
    console.error(error.code || error.message);
    console.error(error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

testConnection();
