const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, Timestamp, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET);


const corsConfig = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionsSuccessStatus: 200,
}

app.use(cors(corsConfig));
app.use(express.json());
app.use(cookieParser());

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(403).send({ message: 'Access denied. No token provided.' });
    }
    if (token) {
        jwt.verify(token, process.env.JWT_TOKEN, (error, decoded) => {
            if (error) {
                return res.status(403).send({ message: 'Access denied. Invalid token.' });
            }
            req.user = decoded;
            next();
        })
    }
}




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mmutbdd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection

        const userCollection = client.db('DropMate').collection('Users')
        const bookingCollection = client.db('DropMate').collection('Parcel_Booking');

        const verifyUser = async (req, res, next) => {
            const user = req.user;
            const query = { email: user?.email }
            const result = await userCollection.findOne(query)
            if (!result || result.userRole !== 'User') {
                return res.status(404).send({ message: 'User not found.' })
            }
            next()
        }
        const verifyAdmin = async (req, res, next) => {
            const user = req.user;
            const query = { email: user?.email }
            const result = await userCollection.findOne(query)
            if (!result || result.userRole !== 'Admin') {
                return res.status(404).send({ message: 'User not found.' })
            }
            next()
        }
        const verifyDeliveryMan = async (req, res, next) => {
            const user = req.user;
            const query = { email: user?.email }
            const result = await userCollection.findOne(query)
            if (!result || result.userRole !== 'DeliveryMan') {
                return res.status(404).send({ message: 'User not found.' })
            }
            next()
        }


        app.get('/', (req, res) => {
            res.send('Hello from DropMate!')
        })

        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_TOKEN, { expiresIn: '7d' })
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
            }).send({ message: 'Token Set Done' })
        })

        app.get('/remove_token', async (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                maxAge: 0
            }).send({ message: 'Token Removed' })
        })

        // if new user come add to DB,if older user come return user is already exists
        app.put('/user', async (req, res) => {
            const user = req.body;
            const isExist = await userCollection.findOne({ email: user.email })
            if (isExist) return res.status(401).send({ message: 'User already registered' })
            const query = { email: user?.email || '' }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    ...user,
                    Timestamp: Date.now()
                }
            }
            const result = await userCollection.updateOne(query, updateDoc, options)
            res.send(result)

        })

        //Loading user Role
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email })
            if (!user) return res.status(404).send({ message: 'User not found' })
            res.send(user)
        })

        //Add booking data
        app.post('/booking', async (req, res) => {
            const bookingData = req.body;
            const result = await bookingCollection.insertOne(bookingData);
            res.send(result)
        })

        //User info
        app.get('/booking/:email', verifyToken, verifyUser, async (req, res) => {
            const email = req.params.email;
            const bookingData = await bookingCollection.find({ senderEmail: email }).toArray();
            res.send(bookingData)
        })

        //Update User Parcel
        app.put('/update_parcel', verifyToken, verifyUser, async (req, res) => {
            const parcel = req.body;
            const { _id, ...updateData } = parcel;

            if (!_id) {
                return res.status(400).send({ message: "Parcel ID is required" });
            }

            const query = { _id: new ObjectId(_id) };
            const updateDoc = {
                $set: updateData
            };

            try {
                const result = await bookingCollection.updateOne(query, updateDoc);
                res.send(result);
            } catch (error) {
                console.error("Error updating parcel:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        //Delete User Parcel
        app.delete('/delete_booking/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bookingCollection.deleteOne(query);
            res.send(result);

        });

        //For Stripe Payment
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            try {
                // Create a PaymentIntent with the order amount and currency
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: "usd",
                    payment_method_types: ['card'] // corrected parameter name
                });

                res.send({
                    clientSecret: paymentIntent.client_secret,
                });
            } catch (error) {
                console.error("Error creating PaymentIntent:", error);
                res.status(500).send({ error: error.message });
            }
        });
















        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
