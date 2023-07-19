const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const moment = require("moment");
const cron = require("node-cron");
const dotenv = require("dotenv");
const db = require("./db/pgsql");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const multer = require("multer");

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

const allowedOrigins = [
  "http://localhost:3000",
  "https://candid-moxie-687458.netlify.app",
];

app.use(
  cors({
    origin: allowedOrigins,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(limiter);
app.use(express.json());
app.use(helmet());
app.use("/images", express.static("images"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "images"); // Specify the destination directory for storing uploaded images
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname); // Generate a unique filename for the uploaded image
  },
});

const upload = multer({ storage });

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    req.userId = decoded.userId;
    next();
  });
};

// Connect to the database and start the server
async function startServer() {
  try {
    await db.connect();

    cron.schedule("10 3 * * *", fetchDataAndSaveToDB, {
      timezone: "Asia/Riyadh",
    });

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    process.on("SIGINT", async () => {
      await db.end();
      console.log("PostgreSQL client connection closed");
      process.exit(0);
    });
  } catch (err) {
    console.error("Error connecting to the database", err);
  }
}

// Login endpoint
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const user = await db.prisma.user.findUnique({ where: { username } });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });
    const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ token, refreshToken });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "An error occurred during login" });
  }
});

// Signup endpoint
app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "Username, email, and password are required" });
    }

    const existingUser = await db.prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
    });

    if (existingUser) {
      return res
        .status(409)
        .json({ error: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await db.prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
      },
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ token });
  } catch (error) {
    console.error("Error during sign up:", error);
    res.status(500).json({ error: "An error occurred during sign up" });
  }
});

app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    // Fetch user information from the database, including the profileImage column
    const user = await db.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        profileImage: true, // Include the profileImage column in the select
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Construct the profile image URL
    const profileImage = `http://localhost:8000/images/${user.profileImage}`;

    // Return the user information and profile image URL in the response
    res.json({ ...user, profileImage });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user profile" });
  }
});

app.post(
  "/profile/image",
  authenticateToken,
  upload.single("image"),
  async (req, res) => {
    try {
      const userId = req.userId;
      const image = req.file; // Access the uploaded image file

      // Update the user's profileImage column in the database with the new image filename or URL
      await db.prisma.user.update({
        where: { id: userId },
        data: {
          profileImage: image.filename, // Save the image filename to the profileImage column
        },
      });

      res.status(200).send("Image profile updated");
    } catch (error) {
      console.error("Error updating image profile:", error);
      res.status(500).json({ error: "Error updating image profile" });
    }
  }
);

// Update data endpoint
app.get("/update", (req, res) => {
  fetchDataAndSaveToDB()
    .then(() => {
      res.status(200).send("Data updated");
    })
    .catch((error) => {
      res.status(500).send("Error updating data");
    });
});

// Get prices endpoint
app.get("/prices", async (req, res) => {
  try {
    const prices = await db.prisma.price.findMany({
      take: 5,
      orderBy: { id: "desc" },
    });

    console.log("Data fetched", prices);
    res.json(prices);
  } catch (error) {
    console.error("Error :", error);
    res.status(500).json({ error: "Error fetching data" });
  }
});

// ...

app.delete(
  "/delete-display/:displayId",
  authenticateToken,
  async (req, res) => {
    try {
      const displayId = req.params.displayId;
      const userId = req.userId;

      // Check if the authenticated user owns the specified display
      const display = await db.prisma.display.findFirst({
        where: {
          display_id: displayId,
          userId,
        },
      });

      if (!display) {
        return res.status(404).json({ error: "Display not found" });
      }

      // Delete the display
      await db.prisma.display.delete({
        where: {
          id: display.id,
        },
      });

      res.status(200).send("Display deleted");
    } catch (error) {
      console.error("Error deleting display:", error);
      res.status(500).send("Error deleting display");
    }
  }
);

// ...

app.put("/update-display/:displayId", authenticateToken, async (req, res) => {
  try {
    const { displayId } = req.params;
    const { display_id, type, isActive, ipAddress, data } = req.body;
    const userId = req.userId;

    // Check if the authenticated user owns the specified display
    const display = await db.prisma.display.findFirst({
      where: {
        display_id: displayId,
        userId,
      },
    });

    if (!display) {
      return res.status(404).json({ error: "Display not found" });
    }

    // Update the display with the received data
    const updatedDisplay = await db.prisma.display.update({
      where: {
        id: display.id,
      },
      data: {
        display_id,
        type,
        data,
        isActive,
        ipAddress,
      },
    });

    res.status(200).json(updatedDisplay);
  } catch (error) {
    console.error("Error updating display:", error);
    res.status(500).send("Error updating display");
  }
});

// ...

app.post("/create-display", authenticateToken, async (req, res) => {
  try {
    const { display_id, type, data, isActive, ipAddress } = req.body;

    const userId = req.userId;

    // Check if the authenticated user already has a display with the same display_id
    const existingDisplay = await db.prisma.display.findFirst({
      where: {
        display_id,
        userId,
      },
    });

    if (existingDisplay) {
      return res.status(409).json({ error: "Display ID already exists" });
    }

    // Create the new display
    const newDisplay = await db.prisma.display.create({
      data: {
        display_id,
        type,
        data,
        ipAddress,
        isActive,
        user: {
          connect: { id: userId },
        },
      },
    });

    res.status(201).json(newDisplay);
  } catch (error) {
    console.error("Error creating display:", error);
    res.status(500).json({ error: "Error creating display" });
  }
});

app.get("/display/:displayId", authenticateToken, async (req, res) => {
  const { displayId } = req.params;

  try {
    const display = await db.prisma.display.findUnique({
      where: { display_id: displayId },
    });

    if (!display) {
      return res.status(404).json({ error: "Display not found" });
    }

    res.status(200).json(display);
  } catch (error) {
    console.error("Error retrieving display:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// ...
app.get("/displays", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    // Fetch displays owned by the authenticated user
    const displays = await db.prisma.display.findMany({
      where: {
        userId,
      },
    });

    res.json(displays);
  } catch (error) {
    console.error("Error fetching displays:", error);
    res.status(500).json({ error: "Error fetching displays" });
  }
});

// Fetch data and save to the database
async function fetchDataAndSaveToDB() {
  try {
    const url = process.env.URL;
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);
    const prices = [];
    let orderID = 1;

    $(".key-facts-full__fact-wrapper").each(function () {
      const figure = parseFloat($(this).find(".key-facts-full__figure").text());
      const description = $(this).find(".key-facts-full__description").text();
      const quote = $(".key-facts-full__quote").find("p").text();

      prices.push({ orderID, figure, description, quote });
      orderID++;
    });

    const createdPrices = await db.prisma.price.createMany({
      data: prices.map((price) => ({
        orderID: price.orderID,
        figure: price.figure,
        description: price.description,
        quote: price.quote,
        created_at: new Date(),
      })),
      skipDuplicates: true,
    });

    console.log("Prices inserted into PostgreSQL:", createdPrices);
  } catch (error) {
    console.error("Error fetching data and saving to DB", error);
  }
}

// ...

// Data endpoint
// app.get("/data", async (req, res) => {
//   try {
//     const { chip_id } = req.query;

//     if (!chip_id) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     const display = await db.prisma.display.findUnique({
//       where: {
//         display_id: chip_id,
//       },
//       include: {
//         user: true,
//       },
//     });

//     if (!display) {
//       return res.status(404).json({ error: "Display not found" });
//     }

//     const responseData = {
//       data: display.data,
//     };

//     res.status(200).json(responseData);
//   } catch (error) {
//     console.error("Error handling data request:", error);
//     res.status(500).json({ error: "Error handling data request" });
//   }
// });

// ...

app.put("/profile/password", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "New password is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.status(200).send("Password updated successfully");
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ error: "Error updating password" });
  }
});

app.post(
  "/profile/image",
  authenticateToken,
  upload.single("image"),
  async (req, res) => {
    try {
      const userId = req.userId;
      const image = req.file; // Access the uploaded image file

      // Update the user's profileImage column in the database with the new image filename or URL
      await db.prisma.user.update({
        where: { id: userId },
        data: {
          profileImage: image.filename, // Save the image filename to the profileImage column
        },
      });

      res.status(200).send("Profile image updated");
    } catch (error) {
      console.error("Error updating profile image:", error);
      res.status(500).json({ error: "Error updating profile image" });
    }
  }
);

// ...

// Start the server
startServer();
