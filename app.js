const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initDbAndServer = async (request, response) => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log(`Server running on http://localhost:3000`);
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initDbAndServer();

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUser = `
    SELECT username FROM user
    WHERE username = '${username}';
    `;
  const dbUser = await db.get(checkUser);

  if (dbUser !== undefined) {
    response.status(400);
    response.send(`User already exists`);
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send(`Password is too short`);
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const requestQuery = `
            INSERT into user(name,username,password,gender) 
            VALUES (
                '${name}',
                '${username}',
                '${hashedPassword}',
                '${gender}'
            );
            `;
      await db.run(requestQuery);
      response.status(200);
      response.send(`User created successfully`);
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT * FROM user 
    WHERE username = '${username}';
    `;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send(`Invalid user`);
  } else {
    const ifPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (ifPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send(`Invalid password`);
    }
  }
});

const authenticateToken = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send(`Invalid JWT Token`);
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send(`Invalid JWT Token`);
      } else {
        request.username = payload.username;
        console.log(request.username);
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  let { username } = request;
  const getUserIdQuery = `
    SELECT user_id FROM user 
    WHERE username = '${username}';
    `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);
  const { tweetId } = request.params;
  const getTweetQuery = `
    SELECT * FROM tweet 
    INNER JOIN follower ON 
    tweet.user_id = follower.following_user_id
    WHERE 
    tweet.tweet_id = ${tweetId} AND follower_user_id = ${getUserId.user_id};
    `;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send(`Invalid Request`);
  } else {
    next();
  }
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  try {
    let { username } = request;
    console.log(username, "username");
    const getUserIdQuery = `
      SELECT user_id FROM user
      WHERE username = '${username}';
      `;
    const getUserId = await db.get(getUserIdQuery);
    console.log(getUserId, "logged user_id");

    const tweetsQuery = `
    SELECT
    user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM
    follower
    INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id
    INNER JOIN user
    ON tweet.user_id = user.user_id
    WHERE
    follower.follower_user_id = ${getUserId.user_id}
    ORDER BY
    tweet.date_time DESC
    LIMIT 4;`;
    const responseResult = await db.all(tweetsQuery);
    response.send(responseResult);
  } catch (e) {
    console.log(`DB error: ${e.message}`);
  }
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `
    SELECT user_id FROM user 
    WHERE username = '${username}';
    `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);

  const userNameQuery = `
    SELECT user.name FROM user
    INNER JOIN follower ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = ${getUserId.user_id};
    `;
  const responseResult = await db.all(userNameQuery);
  response.send(responseResult);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `
    SELECT user_id FROM user 
    WHERE username = '${username}';
    `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);

  const userNameQuery = `
    SELECT user.name FROM user
    INNER JOIN follower ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ${getUserId.user_id};
    `;
  const responseResult = await db.all(userNameQuery);
  response.send(responseResult);
});

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `
        SELECT user_id FROM user 
        WHERE username = '${username}';
        `;
    const getUserId = await db.get(getUserIdQuery);
    console.log(getUserId);

    const getTweetQuery = `
    SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime 
    FROM tweet 
    WHERE tweet.tweet_id = ${tweetId};
    `;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `
        SELECT user_id FROM user 
        WHERE username = '${username}';
        `;
    const getUserId = await db.get(getUserIdQuery);
    console.log(getUserId);

    const checkTheTweetUser = `
  	  select * from tweet inner join follower on tweet.user_id =   
      follower.following_user_id
      where tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${getUserId.user_id};`;

    const tweet = await db.get(checkTheTweetUser);

    if (tweet === undefined) {
      response.status(400);
      response.send(`Invalid Request`);
    } else {
      const getLikesQuery = `
    SELECT user.username FROM user 
    INNER JOIN like ON 
    user.user_id = like.like_id
    WHERE like.tweet_id = ${tweetId};
    `;
      const likedUsers = await db.all(getLikesQuery);
      const likes = likedUsers.map((eachUser) => {
        return eachUser["username"];
      });
      response.send(likes);
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `
        SELECT user_id FROM user 
        WHERE username = '${username}';
        `;
    const getUserId = await db.get(getUserIdQuery);
    console.log(getUserId);
    const checkTheTweetUser = `
        select * from tweet inner join follower on tweet.user_id =   
        follower.following_user_id
        where tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${getUserId.user_id};`;
    const tweet = await db.get(checkTheTweetUser);
    if (tweet === undefined) {
      response.status(400);
      response.send(`Invalid Request`);
    } else {
      const getReplyQuery = `
        SELECT name,reply FROM user
        INNER JOIN reply ON 
        user.user_id = reply.reply_id 
        WHERE reply.tweet_id = ${tweetId};
        `;
      const repliedUsers = await db.all(getReplyQuery);
      response.send({ replies: repliedUsers });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `
    SELECT user_id FROM user 
    WHERE username = '${username}';
    `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);
  const getTweetQuery = `
    SELECT tweet,
    COUNT(DISTINCT(like_id)) AS likes,
    COUNT(DISTINCT(reply_id)) AS replies,
    date_time AS dateTime 
    FROM tweet 
    LEFT JOIN reply ON 
    tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${getUserId.user_id}
    GROUP BY tweet.tweet_id;
    `;
  const tweets = await db.all(getTweetQuery);
  response.send(tweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  let { username } = request;
  const getUserIdQuery = `
    SELECT user_id FROM user 
    WHERE username = '${username}';
    `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);

  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `
    INSERT INTO tweet(tweet,user_id,date_time)
    VALUES ('${tweet}','${getUserId.userId}','${dateTime}');
    `;
  await db.run(createTweetQuery);
  response.send(`Created a Tweet`);
});

app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  let { username } = request;
  const getUserIdQuery = `
        SELECT user_id FROM user 
        WHERE username = '${username}';
        `;
  const getUserId = await db.get(getUserIdQuery);
  console.log(getUserId);

  const getTheTweetQuery = `
    SELECT * FROM tweet 
    WHERE
    user_id = ${getUserId.user_id} AND 
    tweet_id = ${tweetId};
    `;
  const tweet = await db.get(getTheTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send(`Invalid Request`);
  } else {
    const deleteTweetQuery = `
        DELETE FROM tweet 
        WHERE
        tweet.tweet_id = ${tweetId};
        `;
    await db.run(deleteTweetQuery);
    response.send(`Tweet Removed`);
  }
});

module.exports = app;
