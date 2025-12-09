const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const admin = require("firebase-admin");

const serviceAccount = require("./bookcourier-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(express.json());
app.use(cors());
const verifyFBToken = async (req, res, next) => {
  // console.log("headers in the middleware", req.headers.authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

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
    const usersCollection = db.collection("users");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const librariansCollection = db.collection("librarians");

    //middleware with database access
    //verify admin before allowing admin activity
    //must be used after verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //verify Librarian

    const verifyLibrarian = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "librarian") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //users related APIs
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;

      const query = {};
      if (searchText) {
        //query.displayName = searchText;
        //query.name = searchText;
        // query.name = { $regex: searchText, $options: "i" };
        query.$or = [
          { name: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      const cursor = usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(15);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;

      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //Books Related  API
    // app.get("/books", async (req, res) => {});
    // app.get("/books", async (req, res) => {
    //   try {
    //     const books = await booksCollection.find({}).toArray(); // get all books
    //     res.status(200).json(books);
    //   } catch (error) {
    //     console.error("Error fetching books:", error);
    //     res.status(500).send("Internal Server Error");
    //   }
    // });

    // GET /books -> only published books shown by default
    // Get ALL books (for public AllBooks page)
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    // app.post("/books", async (req, res) => {
    //   const book = req.body;
    //   const result = await booksCollection.insertOne(book);
    //   res.send(result);
    // });

    // POST /books -> simple JSON, librarian only
    app.post("/books", verifyFBToken, verifyLibrarian, async (req, res) => {
      try {
        const ownerEmail = req.decoded_email;
        const {
          title,
          author,
          price = 0,
          cover = "",
          status = "published",
          publicationDate,
        } = req.body;

        if (!title || !author) {
          return res
            .status(400)
            .json({ message: "title and author are required" });
        }

        const book = {
          title,
          author,
          price: Number(price) || 0,
          cover, // expects image URL string
          status: status === "published" ? "published" : "unpublished",
          ownerEmail,
          createdAt: new Date(),
          publicationDate: publicationDate ? new Date(publicationDate) : null,
        };

        const result = await booksCollection.insertOne(book);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error("POST /books error:", err);
        res
          .status(500)
          .json({ message: "Failed to add book", error: err.message });
      }
    });
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = usersCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

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

    //MyBooks related API for the Librarians

    // GET /my-books
    // - secure: requires verifyFBToken and verifyLibrarian
    // - returns books where ownerEmail === req.decoded_email
    app.get("/my-books", verifyFBToken, verifyLibrarian, async (req, res) => {
      try {
        const librarianEmail = req.decoded_email;
        if (!librarianEmail) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const query = { ownerEmail: librarianEmail };
        const books = await booksCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json(books);
      } catch (err) {
        console.error("GET /my-books error:", err);
        res
          .status(500)
          .json({ message: "Failed to fetch my books", error: err.message });
      }
    });

    //for the librarians dashboard, librariansOrders related API

    app.get("/librarian-orders", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }

      const orders = await ordersCollection
        .find({ librarianEmail: email })
        .sort({ orderDate: -1 })
        .toArray();

      res.send(orders);
    });

    //orders related API

    // app.post("/orders", async (req, res) => {
    //   try {
    //     const order = req.body;
    //     order.orderDate = new Date();
    //     //order created time
    //     order.createdAt = new Date();
    //     const result = await ordersCollection.insertOne(order);
    //     res.status(201).json(result);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Failed to place order" });
    //   }
    // });

    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;

        // Set timestamps (keep your existing logic)
        order.orderDate = new Date();
        order.createdAt = new Date();

        // Get the book info to attach librarianEmail
        const book = await booksCollection.findOne({
          _id: new ObjectId(order.bookId),
        });

        if (!book) {
          return res.status(404).json({ message: "Book not found" });
        }

        // Attach librarianEmail from the book
        // order.librarianEmail = book.librarianEmail;
        order.librarianEmail = book.ownerEmail;

        // Insert the order
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

      //PH
      // if (email !== req.decoded_email) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      if (!email) {
        return res
          .status(400)
          .json({ message: "Email query parameter is required" });
      }

      try {
        const options = { sort: { createdAt: -1 } };
        const orders = await ordersCollection
          .find({ userEmail: email }, options)
          .toArray();
        res.status(200).json(orders);
      } catch (err) {
        console.error("Error fetching orders:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Delete order when cancelling
    app.delete("/orders/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await ordersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Order not found" });
        }

        res.status(200).json({ message: "Order deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    //**** */
    // GET single order by id (used by Payment.jsx)
    app.get("/orders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).json({ message: "Order not found" });
        res.json(order);
      } catch (err) {
        console.error("GET /orders/:id error:", err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.post("/checkout-session", async (req, res) => {
      try {
        const { orderId, userEmail } = req.body;
        if (!orderId || !userEmail)
          return res
            .status(400)
            .json({ message: "orderId and userEmail required" });

        const order = await ordersCollection.findOne({
          _id: new ObjectId(orderId),
        });
        if (!order) return res.status(404).json({ message: "Order not found" });

        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        const amount = Math.round(Number(order.price) * 100); // cents

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: order.bookTitle || "Book Order",
                  description: `Payment for order: ${order.bookTitle}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            orderId: order._id.toString(),
            bookTitle: order.bookTitle,
          },
          customer_email: userEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.json({ url: session.url, id: session.id });
      } catch (err) {
        console.error("Checkout session error:", err);
        res.status(500).json({
          message: "Failed to create checkout session",
          error: err.message,
        });
      }
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res.status(400).json({ message: "session_id required" });

        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.json({ success: false, message: "Payment not completed" });
        }

        const orderId = session.metadata.orderId;
        const trackingId = `TRK-${Math.random()
          .toString(36)
          .substring(2, 9)
          .toUpperCase()}`;

        await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              status: "paid",
              paymentStatus: "paid",
              transactionId: session.payment_intent,
              trackingId,
              paidAt: new Date(),
            },
          }
        );

        res.json({
          success: true,
          transactionId: session.payment_intent,
          trackingId,
        });
      } catch (err) {
        console.error("Payment success error:", err);
        res
          .status(500)
          .json({ message: "Failed to process payment", error: err.message });
      }
    });

    //librarians related API

    app.get("/librarians", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = librariansCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/librarians", async (req, res) => {
      const librarian = req.body;
      librarian.status = "pending";
      librarian.createdAt = new Date();

      const result = await librariansCollection.insertOne(librarian);
      res.send(result);
    });

    app.patch("/librarians/:id", verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
        },
      };
      const result = await librariansCollection.updateOne(query, updatedDoc);

      if (status === "approved") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "librarian",
          },
        };
        const userResult = await usersCollection.updateOne(
          userQuery,
          updateUser
        );
      }
      res.send(result);
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
