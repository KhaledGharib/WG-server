const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function connect() {
  try {
    await prisma.$connect();
    console.log("Connected to PostgreSQL");
  } catch (err) {
    console.error("Error connecting to PostgreSQL", err);
  }
}

async function end() {
  try {
    await prisma.$disconnect();
    console.log("PostgreSQL connection closed");
  } catch (err) {
    console.error("Error closing PostgreSQL connection", err);
  }
}

module.exports = { prisma, connect, end };
