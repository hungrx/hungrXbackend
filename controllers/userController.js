
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/userModel'); // Assuming you have a User model
const UserActivity = require('../models/trackUserModel')
const Weight = require('../models/userWeightModel')
require('dotenv').config()
const twilio = require('twilio');
// Function to hash the password
const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};

// Function to generate JWT
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

const verifyToken = (req, res, next) => {
    // Get token from header
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach the decoded user id to the request object for use in other routes
        // req.userId = decoded.id;
        req.user = decoded
        next(); // Proceed to the next middleware or route handler
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token.' });
    }
};

// Signup with email and return JWT in response
const signupWithEmail = async (req, res) => {
    const { email, password, reenterPassword } = req.body;

    // Check if passwords match
    if (password !== reenterPassword) {
        return res.status(400).json({
            data: {
                message: 'Passwords do not match'
            }
        });
    }

    try {
        // Check if email already exists
        let user = await User.findOne({ email });

        if (user && user.isVerified) {
            return res.status(400).json({
                data: {
                    message: 'Email already exists'
                }
            });
        }

        // Hash the password
        const hashedPassword = await hashPassword(password);

        if (!user) {
            // Create new user
            user = new User({
                email,
                password: hashedPassword,
                isVerified: false,
            });
        } else {
            // Update existing user with new password
            user.password = hashedPassword;
            user.isVerified = false;
        }

        await user.save();

        // Generate JWT token
        const token = generateToken(user._id);

        // Send response with JWT token
        return res.status(201).json({
            data: {
                message: 'Registration successful.',
                token: token,
                userId: user._id,
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

const loginWithEmail = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find the user by email
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                data: {
                    message: 'User not found'
                }
            });
        }

        // Compare the provided password with the hashed password in the database
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({
                data: {
                    message: 'Invalid password'
                }
            });
        }

        // Generate JWT token
        const token = generateToken(user._id);

        // Send response with JWT token
        return res.status(200).json({
            data: {
                message: 'Login successful.',
                token: token,
                userId: user._id,
            },
        });
    } catch (err) {
        res.status(500).json({
            data: {
                message: err.message
            }
        });
    }
};


const accountSid = process.env.TWILIO_ACCOUNT_SID;  // Twilio Account SID
const authToken = process.env.TWILIO_AUTH_TOKEN;    // Twilio Auth Token
const serviceSid = process.env.TWILIO_SERVICE_SID;  // Twilio Verify Service SID

const client = twilio(accountSid, authToken);


const sendOTP = async (req, res) => {
    const { mobile } = req.body;

    if (!accountSid || !authToken || !serviceSid) {
        console.error("Twilio credentials are missing. Ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SERVICE_SID are set.");
        process.exit(1); // Stop execution if Twilio credentials are not set
    }

    if (!mobile) {
        return res.status(400).json({
            status: false,
            data: {
                message: "Mobile number is required"
            }
        });
    }

    try {
        // Send OTP via Twilio
        client.verify.v2.services(serviceSid)
            .verifications.create({ to: `+${mobile}`, channel: 'sms' })
            .then(verification => {
                res.status(200).json({
                    data: {
                        message: 'OTP sent', verificationSid: verification.sid
                    }
                });
            })
            .catch(error => res.status(500).json({
                data: {
                    error: error.message
                }
            }));

    } catch (error) {
        res.status(500).json({
            status: false,
            data: {
                message: error.message
            }
        });
    }
};


const verifyOTP = async (req, res) => {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
        return res.status(400).json({
            status: false,
            data: {
                message: "Mobile number and OTP are required"
            }
        });
    }

    try {
        console.log('Service SID:', serviceSid);
        console.log('Mobile:', mobile);
        console.log('OTP:', otp);
        // Verify OTP via Twilio
        const verification_check = await client.verify.v2.services(serviceSid)
            .verificationChecks.create({ to: `+${mobile}`, code: otp });

        if (verification_check.status === 'approved') {
            // Check if the user already exists
            let user = await User.findOne({ mobile });

            if (!user) {
                // Create a new user
                user = new User({
                    mobile,
                    isVerified: true // Mark as verified since OTP is confirmed
                });
                await user.save();
            } else {
                // If user exists, update the verification status
                user.isVerified = true; // Optionally update any other fields if necessary
                await user.save();
            }

            res.status(200).json({
                status: true,
                data: {
                    message: 'OTP verified successfully. User has been created/updated.',
                    userId: user._id, // Returning userId here
                    user,
                }
            });
        } else {
            res.status(400).json({
                status: false,
                data: {
                    message: 'Invalid OTP'
                }
            });
        }
    } catch (error) {
        res.status(500).json({
            status: false,
            data: {
                message: error.message
            }
        });
    }
};




const loginWithGoogle = async (req, res) => {
    const { googleId, email, name } = req.body;

    try {
        let user = await User.findOne({ googleId });

        let message;
        if (!user) {
            // New user, sign them up
            user = new User({ googleId, email, name });
            await user.save();
            message = 'Signup successful';
        } else {
            // Existing user, log them in
            message = 'Login successful';
        }

        // Generate JWT token
        const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
            expiresIn: '1h',
        });

        // Send response
        res.status(200).json({
            status: true,
            data: {
                message,
                token: jwtToken,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                },
            }
        });
    } catch (error) {
        console.error('Error in Google login/signup:', error);
        res.status(500).json({
            status: false,
            data: {
                message: 'Internal server error'
            }
        });
    }
};

const addName = async (req, res) => {
    const {
        userId,
        name,
        gender,
        heightInFeet,   // Height in feet
        heightInInches,
        heightInCm,  // Height in inches
        isMetric,       // Flag to determine metric or imperial
        weightInKg,
        weightInLbs,
        mealsPerDay,
        goal,
        targetWeight,
        weightGainRate,
        activityLevel,
        age,
        profilePhoto
    } = req.body;

    console.log('Request Body:', req.body); // Log the request

    try {
        const user = await User.findOne({ _id: userId });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: {
                    data: 'User not found'
                }
            });
        }
        const updateUserDetails = async (user) => {
            if (name) user.name = name;
            if (gender) user.gender = gender;
            // if (req.file) {
            //     user.profilePhoto = `uploads/${req.file.filename}`;
            // }
            if (profilePhoto) user.profilePhoto = profilePhoto;
            // Simplify height logic
            if (isMetric) {
                user.heightInCm = heightInCm;
            } else {
                user.heightInFeet = heightInFeet;
                user.heightInInches = heightInInches;
            }

            user.isMetric = isMetric;

            // Store weight in both units
            if (weightInKg) {
                user.weightInKg = weightInKg;
            } else if (weightInLbs) {
                user.weightInLbs = weightInLbs;
            }

            if (age) user.age = age;
            if (mealsPerDay) user.mealsPerDay = mealsPerDay;
            if (goal) user.goal = goal;
            if (goal && targetWeight) user.targetWeight = targetWeight;
            if (weightGainRate) user.weightGainRate = weightGainRate;
            if (activityLevel) user.activityLevel = activityLevel;

            await user.save();
            console.log('Updated User:', user); // Log updated user
        };
        ;

        await updateUserDetails(user);

        res.status(200).json({
            status: true,
            data: {
                message: 'User details have been updated successfully'
            },
        });
    } catch (error) {
        console.error('Error updating user details:', error);
        res.status(500).json({
            status: false,
            data: {
                message: 'Internal server error'
            }
        });
    }
};


const calculateUserMetrics = async (req, res) => {
    const { userId } = req.body;

    try {
        const user = await User.findById({ _id: userId }); // Directly use the ID.
        if (!user) {
            return res.status(404).json({
                status: false,
                data: {
                    message: 'User not found'
                }
            });
        }

        const {
            weightInKg,
            weightInLbs,
            heightInCm,
            heightInFeet = 0,
            heightInInches = 0,
            isMetric,
            gender,
            age,
            activityLevel,
            goal,
            targetWeight,
            weightGainRate = 0.5,
        } = user;

        if (!age || !gender || (!weightInKg && !weightInLbs)) {
            return res.status(400).json({
                status: false,
                data: {
                    meassage: 'Missing essential user details'
                }
            });
        }

        // Calculate weight and height based on unit system
        let weight = isMetric ? weightInKg : weightInLbs * 0.453592;
        let height = isMetric
            ? heightInCm / 100
            : ((heightInFeet * 12) + heightInInches) * 0.0254;

        if (!weight || !height) {
            return res.status(400).json({
                status: false,
                data: {
                    message: 'Invalid height or weight'
                }
            });
        }

        // BMR Calculation
        const BMR = gender === 'male'
            ? 10 * weight + 6.25 * (height * 100) - 5 * age + 5
            : 10 * weight + 6.25 * (height * 100) - 5 * age - 161;

        // TDEE Calculation
        const activityMultiplier = {
            'sedentary': 1.2,
            'lightly active': 1.375,
            'moderately active': 1.55,
            'very active': 1.725,
            'extra active': 1.9,
        };
        const TDEE = BMR * (activityMultiplier[activityLevel] || 1.2);

        // BMI Calculation
        const BMI = weight / (height ** 2);

        // Daily Calorie Goal
        let dailyCalorieGoal = TDEE;
        if (goal === 'gain weight') dailyCalorieGoal += 500;
        else if (goal === 'lose weight') dailyCalorieGoal -= 500;

        const totalWeightChange = targetWeight ? Math.abs(targetWeight - weight) : 0;
        const caloriesToReachGoal = totalWeightChange * 7700;

        const weeklyCaloricChange = weightGainRate * 7700;
        const daysToReachGoal = totalWeightChange > 0
            ? Math.ceil((caloriesToReachGoal / weeklyCaloricChange) * 7)
            : 0;

        // Update user metrics and save to DB
        user.BMI = BMI.toFixed(2);
        user.BMR = BMR.toFixed(2);
        user.TDEE = TDEE.toFixed(2);
        user.dailyCalorieGoal = dailyCalorieGoal.toFixed(2);
        user.caloriesToReachGoal = caloriesToReachGoal.toFixed(2);
        user.daysToReachGoal = daysToReachGoal;

        await user.save();

        res.status(200).json({
            status: true,
            data: {
                height: isMetric
                    ? `${(height * 100).toFixed(2)} cm`
                    : `${heightInFeet} ft ${heightInInches} in`,
                weight: isMetric ? `${weightInKg} kg` : `${weightInLbs} lbs`,
                BMI: BMI.toFixed(2),
                BMR: BMR.toFixed(2),
                TDEE: TDEE.toFixed(2),
                dailyCalorieGoal: dailyCalorieGoal.toFixed(2),
                caloriesToReachGoal: caloriesToReachGoal.toFixed(2),
                goalPace: `${weightGainRate} kg per week`,
                daysToReachGoal,
            },
        });
    } catch (error) {
        console.error('Error calculating user metrics:', error);
        res.status(500).json({
            status: false,
            data: {
                message: 'Internal server error'
            }
        });
    }
};

const home = async (req, res) => {
    const { userId } = req.body;

    try {
        const user = await User.findOne({ _id: userId });
        if (!user) {
            return res.status(404).json({
                status: false,
                data: {
                    error: 'User not found'
                }
            });
        }

        const {
            name,
            goal,
            caloriesToReachGoal,
            dailyCalorieGoal,
            daysToReachGoal,
            isMetric,
            weightInKg,
            weightInLbs,
            profilePhoto,
            consumedFood
        } = user;

        if (!caloriesToReachGoal || !dailyCalorieGoal || !daysToReachGoal) {
            return res.status(400).json({
                status: false,
                data: {
                    message: 'Missing essential user details'
                }
            });
        }

        // Calculate total calories consumed today
        const today = new Date().toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '/');

        let totalCaloriesConsumed = 0;
        if (consumedFood?.dates?.[today]) {
            const todaysFoods = consumedFood.dates[today];
            totalCaloriesConsumed = Object.values(todaysFoods).reduce((sum, meal) => {
                return sum + (meal?.totalCalories || 0);
            }, 0);
        }

        const remainingCalories = dailyCalorieGoal - totalCaloriesConsumed;
        const updatedCaloriesToReachGoal = caloriesToReachGoal - totalCaloriesConsumed;

        const goalHeading = goal ? `${goal}` : 'Calorie Goal';
        const weight = isMetric ? `${weightInKg} kg` : `${weightInLbs} lbs`;

        return res.status(200).json({
            status: true,
            data: {
                username: name,
                goalHeading,
                weight,
                caloriesToReachGoal: updatedCaloriesToReachGoal,
                dailyCalorieGoal,
                daysToReachGoal,
                profilePhoto,
                remaining: remainingCalories,
                consumed: totalCaloriesConsumed
            }
        });

    } catch (error) {
        console.error('Error fetching user details:', error);
        return res.status(500).json({
            status: false,
            data: {
                message: 'Server error'
            }
        });
    }
};

const trackUser = async (req, res) => {
    const { userId } = req.body;

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingActivity = await UserActivity.findOne({
            userId,
            date: today,
        });

        if (!existingActivity) {
            const activity = new UserActivity({ userId, date: today });
            await activity.save();
        }

        // Retrieve all activities
        const activities = await UserActivity.find({ userId }).sort({ date: 1 });

        // Format dates and get unique dates only
        const uniqueDates = [...new Set(activities.map(activity => {
            const dateObj = activity.date;
            return `${dateObj.getDate().toString().padStart(2, '0')}-` +
                `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-` +
                `${dateObj.getFullYear()}`;
        }))];

        // Use unique dates length for streak calculation
        const totalStreak = uniqueDates.length;
        const startingDate = activities[0].date;
        const user = await User.findById(userId);
        const goalDays = user.daysToReachGoal || 0;

        const expectedEndDate = new Date(startingDate);
        expectedEndDate.setDate(expectedEndDate.getDate() + goalDays);

        const formattedEndDate = `${expectedEndDate.getDate().toString().padStart(2, '0')}-` +
            `${(expectedEndDate.getMonth() + 1).toString().padStart(2, '0')}-` +
            `${expectedEndDate.getFullYear()}`;

        const daysLeft = Math.max(goalDays - totalStreak, 0);

        res.status(200).json({
            status: true,
            message: 'Activity tracked and retrieved successfully',
            data: {
                userId,
                startingDate: uniqueDates[0],
                expectedEndDate: formattedEndDate,
                totalStreak,
                daysLeft,
                dates: uniqueDates,
            },
        });
    } catch (error) {
        console.error('Error tracking activity:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
        });
    }
};

const updateWeight = async (req, res) => {
    const { userId, newWeight } = req.body;

    try {

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        if (user.isMetric) {
            user.weightInKg = newWeight;
        } else {
            user.weightInLbs = newWeight;
        }

        // Save the updated user information
        await user.save();

        // Create a new weight entry with timestamp
        const weightEntry = new Weight({
            userId: user._id,
            weight: newWeight,
            timestamp: new Date() // Add the current timestamp
        });
        await weightEntry.save();

        res.status(200).json({
            status: true,
            message: 'Weight updated successfully',
            data: {
                userId: user._id,
                weight: newWeight,
                isMetric: user.isMetric,
                timestamp: weightEntry.timestamp.toISOString().split('T')[0].split('-').reverse().join('-') // Format date as DD-MM-YYYY
            }
        });
    } catch (error) {
        console.error('Error updating weight:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error'
        });
    }
};



const getWeightHistory = async (req, res) => {
    const { userId } = req.body;

    try {
        // Fetch user details to get isMetric flag and current weight
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                status: false,
                message: 'User not found',
            });
        }
        console.log(user, "uuuuuuuuuuuuuuuuuuuuuu");

        // Determine the current weight based on isMetric flag
        const currentWeight = user.isMetric ? user.weightInKg : user.weightInLbs;
        console.log(currentWeight, "cccccccccccccccccccccccccccc");


        // Fetch the user's weight history from the Weight collection
        const weightHistory = await Weight.find({ userId }).sort({ timestamp: -1 });

        if (!weightHistory.length) {
            return res.status(404).json({
                status: false,
                message: 'No weight records found',
            });
        }

        const history = [
            // {
            //     weight: currentWeight,
            //     date: "Current Weight", // Latest weight from the user schema
            // },
            ...weightHistory.map((entry) => ({
                weight: entry.weight,
                date: entry.timestamp.toISOString().split('T')[0].split('-').reverse().join('-'), // Format as DD-MM-YYYY
            })),
        ];

        // Construct the response
        res.status(200).json({
            status: true,
            message: 'Weight history retrieved successfully',
            isMetric: user.isMetric,
            currentWeight, // Current weight from user schema
            history,
        });
    } catch (error) {
        console.error('Error fetching weight history:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
        });
    }
};

const checkUser = async (req, res) => {
    const { userId } = req.body
    try {
        const user = await User.findById(userId);
        if (user && user.age) {
            return res.status(200).json({
                status: true,
                data: {
                    message: 'User details exists',
                },
            })
        } else {
            return res.status(404).json({
                status: false,
                data: {
                    message: 'Please add details',
                },
            });
        }
    } catch (error) {
        console.error('Error checking user:', error);
        return res.status(500).json({
            status: false,
            data: {
                message: 'Internal Server Error',
            },
        });
    }
}

module.exports = { signupWithEmail, loginWithEmail, verifyToken, sendOTP, verifyOTP, loginWithGoogle, addName, calculateUserMetrics, home, trackUser, updateWeight, getWeightHistory, checkUser };

