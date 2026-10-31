import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import dns from "node:dns/promises";

// DNS সমস্যা এড়ানোর জন্য
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

app.use(cors());
app.use(express.json());

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");
const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

// 🔐 JWT Verification Middleware (BetterAuth JWKS)
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
  );

  try {
    await jwtVerify(token, JWKS);
    next();
  } catch (error) {
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
};

// 📚 BOOKS ROUTES

// GET /books — public, sorted newest first
app.get("/books", async (req, res) => {
  try {
    const books = await booksCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(books);
  } catch (error) {
    res.status(500).json({ msg: "Failed to fetch books" });
  }
});

// GET /books/:id — one book
app.get("/books/:id", async (req, res) => {
  try {
    // MongoDB তে আইডি স্ট্রিং হিসেবে আসে, তাই Number() এ কনভার্ট করা হলো
    const book = await booksCollection.findOne({ _id: Number(req.params.id) });
    if (!book) return res.status(404).json({ msg: "Book not found" });
    res.json(book);
  } catch (error) {
    res.status(500).json({ msg: "Invalid book ID" });
  }
});

// POST /books — protected
app.post("/books", verifyToken, async (req, res) => {
  try {
    // নতুন বই অ্যাড করার সময় যদি _id না থাকে, তবে সর্বোচ্চ _id এর সাথে ১ যোগ করে দেয়া হচ্ছে
    const lastBook = await booksCollection.find().sort({ _id: -1 }).limit(1).toArray();
    const newId = lastBook.length > 0 ? lastBook[0]._id + 1 : 1;

    const book = {
      _id: newId,
      ...req.body,
      createdAt: new Date(),
      availableCopies: req.body.totalCopies || 1,
    };
    const result = await booksCollection.insertOne(book);
    res.status(201).json(book);
  } catch (error) {
    res.status(500).json({ msg: "Failed to add book", error: error.message });
  }
});

// PATCH /books/:id — protected
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

// DELETE /books/:id — protected
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const result = await booksCollection.deleteOne({ _id: Number(req.params.id) });
    res.json(result);
  } catch (error) {
    res.status(500).json({ msg: "Failed to delete book" });
  }
});

// 📖 BORROWS ROUTES

// POST /borrows — protected, borrow a book
app.post("/borrows", verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail } = req.body;
    const numericBookId = Number(bookId);

    // Check if already borrowed by same user
    const existing = await borrowsCollection.findOne({
      bookId: numericBookId,
      userEmail,
      status: "active",
    });
    if (existing) {
      return res.status(400).json({ msg: "You already borrowed this book" });
    }

    // Check available copies
    const book = await booksCollection.findOne({ _id: numericBookId });
    if (!book || book.availableCopies <= 0) {
      return res.status(400).json({ msg: "No copies available" });
    }

    // Decrease available copies
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
      returnDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: "active",
    };
    const result = await borrowsCollection.insertOne(borrow);
    res.status(201).json({ ...borrow, _id: result.insertedId });
  } catch (error) {
    res.status(500).json({ msg: "Failed to borrow book" });
  }
});

// GET /borrows — protected, get user's borrows
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

// DELETE /borrows/:id — protected, return a book
// নোট: বরো ডকুমেন্টের _id MongoDB অটোমেটিক ObjectId হিসেবে জেনারেট করে
app.delete("/borrows/:id", verifyToken, async (req, res) => {
  try {
    const borrow = await borrowsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!borrow) return res.status(404).json({ msg: "Borrow record not found" });

    // Increase available copies back
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
  res.json({ message: "Server is running fine!" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});