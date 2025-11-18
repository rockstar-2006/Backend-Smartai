// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      // console.log('protect: bearer token found');
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
      // console.log('protect: cookie token found');
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, token missing' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error('JWT verify error:', err.message || err);
      return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });

    req.user = user;
    next();
  } catch (err) {
    console.error('protect middleware error:', err);
    res.status(401).json({ message: 'Not authorized' });
  }
};
