const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware

app.use(express.json());
app.use(cors());

//mongodb uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ldizubn.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("book_courier_db");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");

    //parcel API
    // app.get("/books", async (req, res) => {});
    app.get("/books", async (req, res) => {
      try {
        const books = await booksCollection.find({}).toArray(); // get all books
        res.status(200).json(books);
      } catch (error) {
        console.error("Error fetching books:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.post("/books", async (req, res) => {
      const book = req.body;
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    // Get single book by ID
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const book = await booksCollection.findOne({ _id: new ObjectId(id) });
        if (!book) {
          return res.status(404).json({ message: "Book not found" });
        }
        res.status(200).json(book);
      } catch (error) {
        console.error("Error fetching book:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    //orders related API

    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;
        order.orderDate = new Date();
        const result = await ordersCollection.insertOne(order);
        res.status(201).json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to place order" });
      }
    });

    // Get orders for a specific user by email
    app.get("/orders", async (req, res) => {
      const email = req.query.email; // fetch email from query params
      if (!email) {
        return res
          .status(400)
          .json({ message: "Email query parameter is required" });
      }

      try {
        const orders = await ordersCollection
          .find({ userEmail: email })
          .toArray();
        res.status(200).json(orders);
      } catch (err) {
        console.error("Error fetching orders:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Cancel order / Update order status
    app.patch("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }

      try {
        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Order not found" });
        }

        res.status(200).json({ message: "Order updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Book Courier Server is Running...");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
