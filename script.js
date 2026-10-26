//-------- Connect Database (supabase) ----------
//-------- provided value ----------
const SUPABASE_URL = "https://ohbytewmjcybxbtwaqsc.supabase.co";
const SUPABASE_KEY = "sb_publishable_P20OO7E4hAUYURpeug-gEg_FLnR2BHa";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

//------------ grab elements ---------
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

//---------- What app remembers while running ----
let currentUser = null; // the user pr null
const names = {}; // user id -> display name
let channel = null; //real time connect

//------- sign up, log in, log out------
async function signUp() {
    const name = displayName.value.trim();
    if (name.length < 2) {
        authMessage.textContent = "Enter a display name (2 to 24 characters).";
        return;
    }

    authMessage.textContent = "Creating your account...";
    const { data, error } = await sb.auth.signUp({
        email: emailInput.value.trim(),
        password: passwordInput.value,
        options: { data: { display_name: name } },
    });

    if (error) {
        authMessage.textContent = error.message;
    }   else if (!data.session) {
        authMessage.textContent = "Check your email to confirm your account.";
    }   else {
        authMessage.textContent = "";
    }
}

async function logIn() {
    authMessage.textContent = "Logging in...";
    const { error } = await sb.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value,
    });
    authMessage.textContent = error ? error.message : "";
}

authForm.addEventListener("submit", (event) => {
    event.preventDefault(); // stop from reloading
    logIn();
});

signupBtn.addEventListener("click", () => {
    if (authForm.reportValidity()) signUp();
});

logoutBtn.addEventListener("click", () => sb.auth.signOut());

//---------- React when login state changes------
sb.auth.onAuthStateChange((event, session) => {
    const user = session ? session.user : null;

  // set timeout
  setTimeout(() => {
     if (user && (!currentUser || currentUser.id !== user.id)) startChat(user);
     if (!user && currentUser) stopChat();
    }, 0);
});

//----- start and stop the chat room -----
async function startChat(user) {
    currentUser = user;
    authScreen.hidden = true;
    chatScreen.hidden = false;
    who.textContent = "Loading...";

    await loadNames();
    who.textContent = names[user.id] || "Signed in";
    await loadMessages();
    listenForNewMessages();
    messageInput.focus();
}

function stopChat() {
    currentUser = null;
    if (channel) sb.removeChannel(channel);
    channel = null;
    messageList.innerHTML = "";
    passwordInput.value = "";
    chatScreen.hidden = true;
    authScreen.hidden = false;
}

// --- - --- show one message on screen ---
function showMessage(msg) {

    if (messageList.querySelector('[data-id="' + msg.id + '"]')) return;

    const isMine = msg.user_id === currentUser.id;
    const item = document.createElement("li");
    item.className = isMine ? "message mine" : "message";
    item.dataset.id = msg.id;

    const author = document.createElement("span");
    author.className = "author";
    author.textContent = names[msg.user_id] || "Unknown";

    const text = document.createElement("p");
    // ----- keeps the page safe from injected html
    text.textContent = msg.content;

    const time = document.createElement("time");
    time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    item.append(author, text, time);
    messageList.appendChild(item);
    messageList.scrollTop = messageList.scrollHeight;
}

// -------- sending msg to database (input) ----
messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const content = messageInput.value.trim();
    if (content === "") return;
    messageInput.value = "";

    // ----- commands not saved
    if (content.startsWith("/")) {
        handleCommand(content);
        return;
    }

    //--- sending only text, database fills who sent the text
    const { data, error } = await sb
      .from("messages")
      .insert({ content: content })
      .select()
      .single();

    if (error) {
        alert("Could not send: " + error.message);
        messageInput.value = content;
        return;
    }  
    showMessage(data);
});

// -------- Reading data from database (Select)
async function loadNames() {
    const { data, error } = await sb
       .from("profiles")
       .select("id, display_name");
    if (error) return console.error(error);

    data.forEach((p) => {
        names[p.id] = p.display_name;
    });
}
    
async function loadMessages() {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return console.error(error);

    messageList.innerHTML = "";
    data.reverse().forEach(showMessage);
}

// --- --- -- get message in realtime
async function nameFor(userId) {
    if (!names[userId]) {
        const { data } = await sb
           .from("profiles")
           .select("display_name")
           .eq("id", userId)
           .single();
        names[userId] = data ? data.display_name : "Unknown";   
    }
    return names[userId];
}

function listenForNewMessages() {
    if (channel) sb.removeChannel(channel);

    channel = sb
      .channel("class-chat")
      .on(
         "postgres_changes",
         { event: "INSERT", schema: "public", table: "messages" },
         async (payload) => {
             await nameFor(payload.new.user_id);
             showMessage(payload.new);
            }
        )
        .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "messages" }, 
            (payload) => removeMessage(payload.old.id)        
        ) 
        .subscribe();
}

function removeMessage(id) {
    const item = messageList.querySelector('[data-id="' + id + '"]');
    if (item) item.remove();
}

//------ API private weather bot get function
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeather(code) {
    if (code === 0) return "clear sky";
    if (code <= 3) return "partly cloudy";
    if (code <= 48) return "foggy";
    if (code <= 57) return "drizzle";
    if (code <= 67) return "rain";
    if (code <= 77) return "snow";
    if (code <= 82) return "rain showers";
    if (code <= 86) return "snow showers";
    return "thunderstorm";
}

async function getWeather(city) {

    const geoURL = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
    const geoResponse = await fetch(geoURL);
    if (!geoResponse.ok) throw new Error("Geocoding failed");
    const geoData = await geoResponse.json();

    if (!geoData.results) {
      return "Sorry, I could not find a city named " + city + ".";
    }
    const place = geoData.results[0];
    
    // --- asking current weather at coordinates    
    const weatherURL =
        WEATHER_URL +
        "?latitude=" + place.latitude +
        "&longitude=" + place.longitude +
        "&current=temperature_2m,weather_code,wind_speed_10m";
    const weatherResponse = await fetch(weatherURL);
    if (!weatherResponse.ok) throw new Error("Weather failed");
    const weatherData = await weatherResponse.json();
    const now = weatherData.current;

    return (
        place.name + ", " + place.country + ": " +
        now.temperature_2m + " degrees C, " +
        describeWeather(now.weather_code) + ", wind " +      
        now.wind_speed_10m + " km/h"
    );
}

async function handleCommand(text) {
    const words = text.split(" ");
    
    if (words[0].toLowerCase() !== "/weather") {
        showBotmessage("Unknown command. Try: /weather Manila");
        return;
    }

    const city = words.slice(1).join(" ").trim();
    if (city === "") {
        showBotmessage("Try it like this: /weather Manila");
        return
    }   

    try {
        showBotmessage(await getWeather(city));       
    } catch (error) {
      console.error(error);
      showBotmessage("The weather service is not answering right now.");
    }
}

function showBotmessage(text) {
    const item = document.createElement("li");
    item.className = "message bot";

    const author = document.createElement("span");
    author.className = "author";
    author.textContent = "WeatherBot (only you can see this)";

    const body = document.createElement("p");
    body.textContent = text;

    item.append(author, body);
    messageList.appendChild(item);
    messageList.scrollTop = messageList.scrollHeight;
}
