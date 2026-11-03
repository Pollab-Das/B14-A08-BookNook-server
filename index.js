import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import dns from "node:dns/promises";


dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const PORT = process.env.PORT || 8000;

const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    return client;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

// CORS 
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000" || "https://b14-a08-book-nook-client.vercel.app" || "https://b14-a08-booknook-server.onrender.com" ,
  credentials: true
}));
app.use(express.json());

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");
const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

// 🔐 JWT Verification Middleware (BetterAuth JWKS)
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL || "http://localhost:3000"}/api/auth/jwks`)
  );

  try {
    await jwtVerify(token, JWKS);
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(401).json({ msg: "Unauthorized: Invalid or expired token" });
  }
};

// 📚 BOOKS ROUTES

// GET /books — public
app.get("/books", async (req, res) => {
  try {
    // createdAt 
    const books = await booksCollection.find().toArray();
    res.json(books);
  } catch (error) {
    res.status(500).json({ msg: "Failed to fetch books" });
  }
});

// GET /books/:id — one book
app.get("/books/:id", async (req, res) => {
  try {
    const book = await booksCollection.findOne({ _id: Number(req.params.id) });
    if (!book) return res.status(404).json({ msg: "Book not found" });
    res.json(book);
  } catch (error) {
    res.status(500).json({ msg: "Invalid book ID format" });
  }
});

// POST /books — protected (Add a Book)
app.post("/books", verifyToken, async (req, res) => {
  try {
    // new _id 
    const lastBook = await booksCollection.find().sort({ _id: -1 }).limit(1).toArray();
    const newId = lastBook.length > 0 ? lastBook[0]._id + 1 : 1;

    const book = {
      _id: newId,
      ...req.body,
      createdAt: new Date(),
      availableCopies: req.body.totalCopies || 1,
    };
    await booksCollection.insertOne(book);
    res.status(201).json(book);
  } catch (error) {
    res.status(500).json({ msg: "Failed to add book", error: error.message });
  }
});

// PATCH /books/:id — protected (Update a Book)
app.patch("/books/:id", verifyToken, async (req, res) => {
  try {
    const result = await booksCollection.updateOne(
      { _id: Number(req.params.id) },
      { $set: req.body }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ msg: "Failed to update book" });
  }
});

// DELETE /books/:id — protected (Delete a Book)
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const result = await booksCollection.deleteOne({ _id: Number(req.params.id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ msg: "Failed to delete book" });
  }
});

// 📖 BORROWS ROUTES

// POST /borrows — protected (Borrow a Book)
app.post("/borrows", verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail } = req.body;
    const numericBookId = Number(bookId);

    
    const existing = await borrowsCollection.findOne({
      bookId: numericBookId,
      userEmail,
      status: "active",
    });
    if (existing) {
      return res.status(400).json({ msg: "You already borrowed this book" });
    }

    
    const book = await booksCollection.findOne({ _id: numericBookId });
    if (!book || book.availableCopies <= 0) {
      return res.status(400).json({ msg: "No copies available" });
    }

    // ($inc)
    await booksCollection.updateOne(
      { _id: numericBookId },
      { $inc: { availableCopies: -1 } }
    );

    const borrow = {
      bookId: numericBookId,
      bookTitle: book.title,
      bookImage: book.image,
      userEmail,
      borrowDate: new Date(),
      returnDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // ৭ দিন পর
      status: "active",
    };
    const result = await borrowsCollection.insertOne(borrow);
    res.status(201).json({ ...borrow, _id: result.insertedId });
  } catch (error) {
    res.status(500).json({ msg: "Failed to borrow book" });
  }
});

// GET /borrows — protected (Get my borrows)
app.get("/borrows", verifyToken, async (req, res) => {
  try {
    const { email } = req.query;
    const borrows = await borrowsCollection
      .find({ userEmail: email })
      .sort({ borrowDate: -1 })
      .toArray();
    res.json(borrows);
  } catch (error) {
    res.status(500).json({ msg: "Failed to fetch borrows" });
  }
});

// DELETE /borrows/:id — protected (Return a book)
app.delete("/borrows/:id", verifyToken, async (req, res) => {
  try {
    const borrow = await borrowsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!borrow) return res.status(404).json({ msg: "Borrow record not found" });

    // copy
    await booksCollection.updateOne(
      { _id: borrow.bookId },
      { $inc: { availableCopies: 1 } }
    );

    await borrowsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ msg: "Book returned successfully" });
  } catch (error) {
    res.status(500).json({ msg: "Failed to return book" });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({ message: "BookNook server is running fine!" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});