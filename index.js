const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const admin = require("firebase-admin");

//This line has been commented for server side deployment
//const serviceAccount = require("./bookcourier-adminsdk.json");

//The 2 lines below are added for server side deployment
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

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
    //The line below has been commented for server side deploy
    // await client.connect();

    const db = client.db("book_courier_db");
    const usersCollection = db.collection("users");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const librariansCollection = db.collection("librarians");
    const reviewsCollection = db.collection("reviews");
    const wishlistsCollection = db.collection("wishlists");

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

    //user record storage *** imp

    app.post("/users", async (req, res) => {
      const { email, name, photoURL } = req.body;

      if (!email) return res.status(400).send({ message: "Email required" });

      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const user = {
        email,
        name: name, // store displayName as name

        photoURL: photoURL, // default avatar
        role: "user",
        createdAt: new Date(),
      };

      //update user collection **imp
      await usersCollection.updateMany({ name: { $exists: false } }, [
        {
          $set: {
            name: "$displayName",
            photoURL: {
              $ifNull: ["$photoURL", "https://i.ibb.co/2FsfXqM/user.png"],
            },
          },
        },
      ]);

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // user Management portion
    app.get("/books", async (req, res) => {
      try {
        // return only published books for public listing
        const books = await booksCollection
          .find({ status: "published" })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(books);
      } catch (err) {
        console.error("GET /books error:", err);
        res.status(500).send({ message: "Failed to load books" });
      }
    });

    //user Management portions
    // get all books (published and unpublished) by admin
    app.get("/admin/books", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const books = await booksCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(books);
      } catch (err) {
        console.error("GET /admin/books error:", err);
        res.status(500).send({ message: "Failed to load books" });
      }
    });

    //  change book status (publish/unpublished) by admin
    app.patch(
      "/books/status/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;
          if (!["published", "unpublished"].includes(status)) {
            return res.status(400).send({ message: "Invalid status" });
          }

          const result = await booksCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );
          res.send(result);
        } catch (err) {
          console.error("PATCH /books/status/:id error:", err);
          res.status(500).send({ message: "Failed to update book status" });
        }
      }
    );

    // 3) Admin: delete a book and delete related orders
    app.delete("/books/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;

        // delete the book
        const deleteBook = await booksCollection.deleteOne({
          _id: new ObjectId(id),
        });

        //delete orders
        const deleteOrders = await ordersCollection.deleteMany({
          $or: [{ bookId: id }, { bookId: new ObjectId(id) }],
        });

        res.send({
          deletedBook: deleteBook,
          deletedOrders: deleteOrders,
        });
      } catch (err) {
        console.error("DELETE /books/:id error:", err);
        res.status(500).send({ message: "Failed to delete book" });
      }
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
          description = "",
          librarianName,
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
          description,
          librarianName,
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

    //Reviews Related API
    app.post("/reviews", verifyFBToken, async (req, res) => {
      try {
        const { bookId, rating, review } = req.body;
        const userEmail = req.decoded_email;

        if (!bookId || !rating || !review) {
          return res
            .status(400)
            .json({ message: "bookId, rating, and review required" });
        }

        // Check if user has ordered this book
        const order = await ordersCollection.findOne({
          bookId,
          userEmail,
          status: "paid", // only allow review if book is purchased
        });

        if (!order) {
          return res
            .status(403)
            .json({ message: "You can only review purchased books" });
        }

        const reviewDoc = {
          bookId,
          userEmail,
          userName: req.body.userName || "", // optionally store name
          rating: Number(rating),
          review,
          createdAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(reviewDoc);
        res.status(201).json(result);
      } catch (err) {
        console.error("POST /reviews error:", err);
        res
          .status(500)
          .json({ message: "Failed to add review", error: err.message });
      }
    });

    app.get("/reviews/:bookId", async (req, res) => {
      try {
        const bookId = req.params.bookId;
        const reviews = await reviewsCollection
          .find({ bookId })
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json(reviews);
      } catch (err) {
        console.error("GET /reviews/:bookId error:", err);
        res.status(500).json({ message: "Failed to fetch reviews" });
      }
    });

    //wish list related API

    // Add book to wishlist
    // Add book to wishlist
    app.post("/wishlist", verifyFBToken, async (req, res) => {
      try {
        const { bookId } = req.body;
        const userEmail = req.decoded_email;

        if (!bookId) {
          return res.status(400).json({ message: "bookId is required" });
        }

        const { ObjectId } = require("mongodb");
        const bookObjId = new ObjectId(bookId); // convert string to ObjectId

        // Check if already in wishlist
        const exists = await wishlistsCollection.findOne({
          userEmail,
          bookId: bookObjId,
        });
        if (exists) {
          return res.status(400).json({ message: "Book already in wishlist" });
        }

        const wishlistItem = {
          userEmail,
          bookId: bookObjId,
          createdAt: new Date(),
        };

        const result = await wishlistsCollection.insertOne(wishlistItem);
        res.status(201).json({ message: "Book added to wishlist", result });
      } catch (err) {
        console.error("POST /wishlist error:", err);
        res
          .status(500)
          .json({ message: "Failed to add to wishlist", error: err.message });
      }
    });

    // Get wishlist for user
    app.get("/wishlist", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        // Get wishlist items with book details
        const wishlistItems = await wishlistsCollection
          .aggregate([
            { $match: { userEmail } },
            {
              $lookup: {
                from: "books",
                localField: "bookId",
                foreignField: "_id",
                as: "bookDetails",
              },
            },
            { $unwind: "$bookDetails" },
            { $sort: { createdAt: -1 } },
          ])
          .toArray();

        res.status(200).json(wishlistItems);
      } catch (err) {
        console.error("GET /wishlist error:", err);
        res
          .status(500)
          .json({ message: "Failed to fetch wishlist", error: err.message });
      }
    });

    // Remove book from wishlist
    app.delete("/wishlist/:bookId", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;
        const bookId = req.params.bookId;

        const result = await wishlistsCollection.deleteOne({
          userEmail,
          bookId,
        });
        res.status(200).json({
          message: "Removed from wishlist",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        console.error("DELETE /wishlist/:bookId error:", err);
        res.status(500).json({
          message: "Failed to remove from wishlist",
          error: err.message,
        });
      }
    });

    // add librarian action added ***imp

    // Make user a librarian
    app.patch(
      "/users/:id/librarian",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        try {
          const query = { _id: new ObjectId(id) };
          const updatedDoc = { $set: { role: "librarian" } };
          const result = await usersCollection.updateOne(query, updatedDoc);

          res.send(result);
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ message: "Failed to update role to librarian" });
        }
      }
    );

    // UPDATE BOOK (EDIT BOOK) - Librarian can edit only their own books
    app.patch(
      "/books/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        try {
          const id = req.params.id;
          const email = req.decoded_email; // logged-in librarian
          const updatedBook = req.body;

          // Only allow librarian to update their own book
          const filter = { _id: new ObjectId(id), ownerEmail: email };

          const updateDoc = {
            $set: {
              title: updatedBook.title,
              author: updatedBook.author,
              category: updatedBook.category,
              price: updatedBook.price,
              cover: updatedBook.cover || updatedBook.image,
              description: updatedBook.description,
              status: updatedBook.status,
              updatedAt: new Date(),
            },
          };

          const result = await booksCollection.updateOne(filter, updateDoc);

          if (result.matchedCount === 0) {
            return res.status(403).send({
              success: false,
              message: "You are not allowed to edit this book",
            });
          }

          res.send({
            success: true,
            message: "Book updated successfully",
            result,
          });
        } catch (err) {
          console.error(err);
          res.status(500).send({
            success: false,
            message: "Failed to update the book",
          });
        }
      }
    );

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
    //The below has been commented to deploy in vercel
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //The line below is commented to deploy safe server side deployment
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
