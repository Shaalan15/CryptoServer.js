const express = require('express');
const bodyParser = require('body-parser');
const expressFormData = require('express-form-data');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const fs = require('fs');
const http = require('http');
const port = 2000;
const DB = "mongodb+srv://admin:Qfwm3772@cluster0.cri1n.mongodb.net/Huawei?retryWrites=true&w=majority";
const SHA256 = require('crypto-js/sha256');
const blockModel = require('./models/blockModel');
const transactionModel = require('./models/transactionModel');

// class to define block structure and content
class Block {
    constructor(from, to, amount, fee, miner, reward = 5) {
        this.index = 0;
        this.from = from;
        this.to = to;
        this.timestamp = Date.now();
        this.amount = amount;
        this.fee = fee;
        this.reward = reward;
        this.miner = miner;
        this.previoushash = 'null';
        this.hash = this.calculateHash();
        this.nonce = 0;
    }
    // method to calculate hash
    calculateHash() {
        return SHA256(this.index + this.previoushash + this.timestamp + JSON.stringify(this.amount) + this.nonce).toString();
    }
    // method to mine the block by repeatedly calculating the hash and increasing the nonce until the difficulty is met
    mineBlock(difficulty) {
        while (this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
    }
}

// class to define the blockchain structure, methods to interact with, and default values
class Blockchain {
    constructor() {
        this.chain = [];
        this.difficulty = 4;
        this.index = 0;
    }
    // method to create the first "genesis" block in the chain
    createGenesisBlock() {
        const newBlock = new Block("null", "null", 0, 0, "null", 0);
        return newBlock;
    }
    // method to get latest block data
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }
    // method to add a new block to the chain
    addBlock(newBlock) {
        newBlock.index = this.index;
        this.index = this.index + 1;
        newBlock.previoushash = this.getLatestBlock().hash;
        newBlock.mineBlock(this.difficulty);
        this.chain.push(newBlock);
    }
    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            if (currentBlock.hash !== currentBlock.calculateHash()) {
                return false;
            }

            if (currentBlock.previoushash !== previousBlock.hash) {
                return false;
            }
        }
        return true;
    }
    getIndex() {
        return this.index;
    }
}

// Mongoose initialization for connection to the database
mongoose
    .connect(DB, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        autoIndex: true,
    })
    .then(() => {
        console.log("DB connected successfully");
    });

//// Express app initialization for serving the content through HTTP requests
// Configure app to be able to read body of packets, specifically urlencoded
app.use(express.urlencoded({ extended: false }));
// Configure app to read json data in body
app.use(express.json());
// Configure app to read form data, or files
app.use(expressFormData.parse());
// Allow Cross-Origin Resource Sharing
app.use(cors());

// default route for the web server
app.get('/', (req, res) => {
    res.send("YAKHICOIN SERVER");
})

// route to list all transactions still pending (from database)
app.get('/list-transactions', (req, res) => {
    transactionModel.find().then(
        (foundTransactions) => {
            res.send(foundTransactions);
        }
    )
})

// route to list all blocks already mined (from database)
app.get('/list-blocks', (req, res) => {
    blockModel.find().then(
        (foundBlocks) => {
            res.send(foundBlocks);
        }
    )
})

// route to add a new pending transaction; the front-end website sends the request with the relevent data
app.post('/add-transaction', (req, res) => {
        console.log("--Transaction received");
        // retrieve all blocks relating to the sender to examine the user; if new user, transfer 1000 coins to user
        blockModel.find({ $or: [{ from: req.body.from }, { to: req.body.from }, { miner: req.body.from }] }).then((blocks) => {
            if (!blocks.length) {
                console.log("  New user");
                yakhicoin.addBlock(new Block("system", req.body.from, 1000, 0, "null", 0));
                const newblock = new blockModel(yakhicoin.getLatestBlock());
                newblock.save().then((success) => {console.log("  Transferred 1000 to new user:", success.hash)});
            }
            // check balance of the sender
            let balance = 0;
            for (const block of blocks) {
                if (block.from == req.body.from) {balance -= (block.amount + block.fee);}
                if (block.to == req.body.from) {balance += block.amount;}
                if (block.miner == req.body.from) {balance += (block.fee + block.reward);}
            }
            // if user has enough balance then the transaction is added to the transactions list in the database, otherwise indicates error
            if ((Number(req.body.amount) + Number(req.body.fee)) <= balance || (!blocks.length && (Number(req.body.amount) + Number(req.body.fee)) <= 1000)) {
                const formData = {
                    "from": req.body.from,
                    "to": req.body.to,
                    "amount": Number(req.body.amount),
                    "fee": Number(req.body.fee)
                }
                const newtransaction = new transactionModel(formData);
                newtransaction
                    .save() //  Promise
                    .then( //resolved...
                        (success) => {
                            res.send({"transaction" : success, "error" : 0});
                        }
                    )
                    .catch( //rejected...
                        (error) => {
                            console.log(error);
                            res.send({"error" : error});
                        }
                    );
            }
            else {
                console.log("  Insufficient balance");
                res.json({"error" : 1});
            }
        })
})

// route to mine a block using the transaction ID send with the request
app.post('/mine-block', (req, res) => {
    console.log("--Mine received");
    // retrieve the indicated transaction from the database
    transactionModel.findOne({ _id: req.body.id }).then((transaction) => {
        // add a new block using the transaction details and mine it, then save in database
        yakhicoin.addBlock(new Block(transaction.from, transaction.to, transaction.amount, transaction.fee, req.body.address));
        const newblock = new blockModel(yakhicoin.getLatestBlock());
        newblock
            .save() //  Promise
            .then( //resolved...
                (success) => {
                    transactionModel.deleteOne({ _id: req.body.id }).then();
                    console.log("  Block", success.index, "mined:", success.hash);
                    res.send(success);
                }
            )
            .catch( //rejected...
                (error) => {
                    yakhicoin.chain.pop();
                    console.log(error);
                    res.send(error);
                }
            );
    })
})

// route to view an address's details; the address is passed with the request
app.post('/view-address', (req, res) => {
    // retrieve all user blocks from the database and compute the balance
    blockModel.find({ $or: [{ from: req.body.address }, { to: req.body.address }, { miner: req.body.address }] }).then((blocks) => {
        let balance = 0;
        for (const block of blocks) {
            if (block.from == req.body.address) {balance -= (block.amount + block.fee);}
            if (block.to == req.body.address) {balance += block.amount;}
            if (block.miner == req.body.address) {balance += (block.fee + block.reward);}
        }
        res.json({"transactions" : blocks, "balance" : balance});
    })
})

// route to reset the blockchain locally and in the database
app.get('/reset', (req, res) => {
    console.log("--RESET RECEIVED")
    mongoose.connection.db.dropCollection("blocks");
    mongoose.connection.db.dropCollection("transactions");
    yakhicoin.chain = [yakhicoin.createGenesisBlock()];
    const newblock = new blockModel(yakhicoin.getLatestBlock());
    newblock.save().then((success) => {console.log("  Genesis block 0 created:", success.hash)});
    yakhicoin.index = 1;
    res.send("RESET COMPLETE");
})

// make Express app begin listening for HTTP requests
app.listen(port, () => {
    console.log(`Server listening on port ${port}`)
})

// initialize the main blockchain object from the blockchain class
let yakhicoin = new Blockchain();
console.log("YakhiCoin is up and running!")