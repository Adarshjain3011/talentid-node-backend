
import Order from "../models/order.model.js"; // Import the Order model

import axios from "axios";

import dotenv from "dotenv";
import { json } from "express";

import { v4 as uuidv4 } from 'uuid'; // Generate unique order ID

import crypto from 'crypto';

import User from "../models/user.model.js";

import { paymentStatusEnum } from "../utils/data.js";


dotenv.config();



export const createPaymentLink = async (req, res) => {
    try {
        const { customerDetails, orderAmount, userId, orderId } = req.body;

        // Step 1: Call Cashfree API to create the payment link
        const response = await axios.post('https://sandbox.cashfree.com/pg/links', {
            customer_details: {
                customer_name: customerDetails.customer_name,
                customer_email: customerDetails.customer_email,
                customer_phone: customerDetails.customer_phone,
                customer_id: userId,
            },
            link_notify: {
                send_sms: true,
                send_email: true,
            },
            order_meta: {
                return_url: 'https://imaginify-git-main-adarshs-projects-f27ee43e.vercel.app/', // Your frontend payment response URL
                notify_url: 'https://c8d3-14-139-238-134.ngrok-free.app/api/payments/cashfree-webhook', // Your backend webhook URL
            },
            link_amount: orderAmount,
            link_currency: "INR",
            link_id: orderId, // Your internal orderId as link_id for Cashfree
            link_purpose: "Payment for service",
            link_minimum_partial_amount: 20,
        }, {
            headers: {
                'x-api-version': '2023-08-01',
                'x-client-id': process.env.CASHFREE_APP_ID, // Use environment variables for security
                'x-client-secret': process.env.CASHFREE_SECRET_KEY, // Use environment variables for security
                'Content-Type': 'application/json',
            },
        });

        console.log("res ka data ", response.data);

        // Step 2: Save the order to the database along with Cashfree link details
        const newOrder = new Order({
            userId,
            orderId,
            customerDetails,
            orderAmount,
            paymentStatus: paymentStatusEnum.PENDING,
            link_id: response.data.link_id, // Save Cashfree's link_id
        });

        await newOrder.save(); // Save the order into the database

        console.log("Order created successfully", newOrder);

        // Step 3: Respond with the payment link and order details
        return res.status(200).json({
            data: {
                paymentLink: response.data.link_url, // Return payment link from Cashfree
                orderId: newOrder._id, // Return the new order's ID
            },
            message: "Payment link generated successfully",
            error: null,
        });
    } catch (error) {
        // Enhanced error handling
        console.error('Error creating payment link:', error);

        return res.status(500).json({
            message: "Error generating payment link",
            error: error.response ? error.response.data : error.message, // Return detailed error if available
            data: null,
        });
    }
};






export async function initializePayemnt(req, res) {

    // Log the entire request body to understand its structure
    console.log("Request body: ", req.body);

    // Extracting the data from the correct nested structure
    const { data } = req.body;
    const { payment_status } = data.payment;

    const { customer_email } = data.customer_details;

    console.log("customer email",data.customer_details.customer_email)

    if (!payment_status || !customer_email) {

        return res.status(400).json({ error: 'Missing required fields in the request' });

    }

    updateOrderDetails(customer_email, payment_status,res);

}







const fetchPaymentLinkDetails = async (linkId) => {

    try {
        const response = await axios.get(`https://sandbox.cashfree.com/pg/links/${linkId}`, {
            headers: {
                'accept': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': process.env.CASHFREE_APP_ID, // Store this securely
                'x-client-secret': process.env.CASHFREE_SECRET_KEY, // Store this securely
                'x-idempotency-key': '47bf8872-46fe-11ee-be56-0242ac120002', // Generate dynamically if needed
                'x-request-id': process.env.CASHFREE_APP_ID // This can also be dynamic or constant
            }
        });

        console.log("Payment Link Details:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error fetching payment details:", error.response ? error.response.data : error.message);
        throw error;
    }
};





export async function updateOrderDetails(customer_email, paymentStatus,res) {
    try {
    

        console.log("Update Order Details:", customer_email,paymentStatus);

        // Check if required fields are present
        if (!customer_email || !paymentStatus) {
            return res.status(400).json({
                message: "Missing required fields in the request",
                error: null,
                data: null,
            });
        }

        // Find the most recent order for the customer based on email
        const mostRecentOrder = await Order.findOne({
            "customerDetails.customer_email": customer_email // Accessing the nested field
        }).sort({ createdAt: -1 }); // Sort to get the most recent order

        // Check if the order exists
        if (!mostRecentOrder) {
            return res.status(404).json({
                message: "No order found for this customer email",
                error: null,
                data: null,
            });
        }

        // Update the payment status
        mostRecentOrder.paymentStatus = paymentStatus;
        await mostRecentOrder.save();

        console.log("updated order with payment status ",mostRecentOrder);

        // now we have to cehck payment status if it is Success then we have to update the Update User Credits 

        if (paymentStatusEnum.SUCCESS == paymentStatus) {

            const userId = mostRecentOrder.userId;

            // Ensure the order has a userId field

            if (!userId) {
                return res.status(404).json({
                    message: "No userId found for this order",
                    error: null,
                    data: null,
                });
            }

            // Calculate the credits to add based on the order amount

            const creditsToAdd = mostRecentOrder.orderAmount * 2; // Example: Multiply order amount to get credits
            // Find the user by userId and increment their credits
            const updateUserCredits = await User.findOneAndUpdate(
                { _id: userId }, // Find the user by userId
                { $inc: { credits: creditsToAdd } }, // Increment the user's credits
                { new: true } // Return the updated user document
            );

            // If the user was found and credits were updated
            if (updateUserCredits) {
                console.log("User credits updated:", updateUserCredits);
            } else {
                return res.status(404).json({
                    message: "User not found for the given order",
                    error: null,
                    data: null,
                });
            }
            // Return success response
            return res.status(200).json({
                message: "Order status and user credits updated successfully",
                error: null,
                data: {
                    order: mostRecentOrder,
                    user: updateUserCredits
                }
            });

        }

        return res.status(200).json({

            message: "Order status updated successfully",
            error: null,
            data: null,

        })
    } catch (error) {

        console.error("Error updating order details:", error.message);

        // Return error response

        console.log("Error updating order details:", error.message);
        return res.status(500).json({
            message: "Error updating order details",
            error: error.message,
            data: null,
        });
    }
}

