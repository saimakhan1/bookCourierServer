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
        //order created time
        order.createdAt = new Date();
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

    /**
     * POST /create-checkout-session
     * Body: { orderId }
     * Creates a Stripe Checkout Session for that order and returns { url, id }
     */
    // app.post("/create-checkout-session", async (req, res) => {
    //   try {
    //     const { orderId } = req.body;
    //     if (!orderId)
    //       return res.status(400).json({ message: "orderId required" });

    //     const order = await ordersCollection.findOne({
    //       _id: new ObjectId(orderId),
    //     });
    //     if (!order) return res.status(404).json({ message: "Order not found" });

    //     // require stripe and env key
    //     const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    //     const siteDomain = process.env.SITE_DOMAIN || "http://localhost:5173/";

    //     // Price and product details
    //     // NOTE: Stripe expects amount in smallest currency unit (e.g., cents for USD).
    //     // If your order.price is in "BDT" (taka) or other currency, adjust currency and amount accordingly.
    //     // Here I'm assuming price is in USD. If using BDT, change currency:'bdt' and amount accordingly.
    //     const unitAmount = Math.round((order.price || 0) * 100); // multiply by 100 to convert to cents

    //     const session = await stripe.checkout.sessions.create({
    //       payment_method_types: ["card"],
    //       mode: "payment",
    //       line_items: [
    //         {
    //           price_data: {
    //             currency: "usd", // CHANGE if you want another currency
    //             product_data: {
    //               name: order.bookTitle || "Order",
    //               description: `Order for ${order.bookTitle}`,
    //             },
    //             unit_amount: unitAmount,
    //           },
    //           quantity: 1,
    //         },
    //       ],
    //       metadata: {
    //         orderId: String(order._id),
    //       },
    //       success_url: `${siteDomain}payment-success?session_id={CHECKOUT_SESSION_ID}`,
    //       cancel_url: `${siteDomain}payment-cancelled`,
    //     });

    //     res.json({ url: session.url, id: session.id });
    //   } catch (err) {
    //     console.error("POST /create-checkout-session error:", err);
    //     res.status(500).json({ message: "Failed to create checkout session" });
    //   }
    // });

    /**
     * PATCH /payment-success?session_id=...
     * This will retrieve Stripe session, confirm payment, and update order in DB.
     * Returns JSON with transactionId and a generated trackingId.
     */
    // app.patch("/payment-success", async (req, res) => {
    //   try {
    //     const sessionId = req.query.session_id;
    //     if (!sessionId)
    //       return res.status(400).json({ message: "session_id required" });

    //     const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    //     // Retrieve session including payment_intent
    //     const session = await stripe.checkout.sessions.retrieve(sessionId, {
    //       expand: ["payment_intent", "line_items"],
    //     });

    //     // get metadata orderId
    //     const orderId = session?.metadata?.orderId;
    //     if (!orderId) {
    //       return res
    //         .status(400)
    //         .json({ message: "Order ID not found in session metadata" });
    //     }

    //     // payment intent id as transaction id
    //     const transactionId = session.payment_intent?.id || session.id;

    //     // Optionally produce a tracking id (simple random)
    //     const trackingId = `TRK-${Math.random()
    //       .toString(36)
    //       .substring(2, 9)
    //       .toUpperCase()}`;

    //     // update DB: set status/paymentStatus and attach transaction/tracking
    //     const result = await ordersCollection.updateOne(
    //       { _id: new ObjectId(orderId) },
    //       {
    //         $set: {
    //           status: "paid",
    //           paymentStatus: "paid",
    //           transactionId,
    //           trackingId,
    //           paidAt: new Date().toISOString(),
    //         },
    //       }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).json({ message: "Order not found" });
    //     }

    //     res.json({ transactionId, trackingId });
    //   } catch (err) {
    //     console.error("PATCH /payment-success error:", err);
    //     res.status(500).json({ message: "Failed to process payment success" });
    //   }
    // });

    // POST /checkout-session

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
        res
          .status(500)
          .json({
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
