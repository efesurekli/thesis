
/* eslint-disable */
import io from 'socket.io-client'
import { eventChannel } from 'redux-saga'
import { fork, take, call, put, cancel } from 'redux-saga/effects'
import req from 'superagent'
import { Actions as NavigationActions } from 'react-native-router-flux';

import {
  loginSuccess,
  loadNotifications,
  updateRegion,
  updatePosition,
} from '../Actions'

//----------------- navigator action ---------------------------
//----------------------------------------------------------
export const getPositionFromNavigator = () => {
  return new Promise ((resolve) => {
     navigator.geolocation.getCurrentPosition (
      (position) => {
        resolve({
          position,
          region: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
        })
      },
      (err) => {console.log('in Saga, getCurrentPosition failed')},
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 },
    )
  })
}
function* getPosition() {
  yield take('GET_POSITION');
  const {position, region} = yield call(getPositionFromNavigator);
  yield put(updatePosition(position));
}
//----------------- REST request ---------------------------
//----------------------------------------------------------

//helper function for login POST
export const loginPostRequest = (username, password) => {
  console.log('in Saga, triggered loginPostRequest');
  const url = 'http://127.0.0.1:8099';
  return req.post(`${url}/api/auth/login`)
    .send({ username, password });
};


//helper function for signup POST
export const signupPostRequest = (username, password, userInfo) => {
  userInfo = userInfo || {firstName: 'John', lastName: 'Appleseed'}
  console.log('userInfo', userInfo);
  const firstName = userInfo.firstName;
  const lastName = userInfo.lastName;
  const email = userInfo.email;
  const url = 'http://127.0.0.1:8099';
  return req.post(`${url}/api/auth/signup`)
    .send({ username, password, firstName, lastName, email });
};

function* login() {
    const { username, password } = yield take('LOGIN_REQUEST')
    const { position, region } = yield call(getPositionFromNavigator);
    yield put(updatePosition(position));
    yield put(updateRegion(region));
    const res = yield call(loginPostRequest, username, password, position)
    const token = res.body.token;
    const userId = res.body.userId;
    const location = {
      latitude: region.latitude,
      longitude: region.longitude,
    };
    yield put(loginSuccess(username, token, userId, location))
}

function* signup() {
    const { username, password, userInfo } = yield take('SIGNUP_REQUEST')
    const {position, region} = yield call(getPositionFromNavigator);
    yield put(updatePosition(position));
    yield put(updateRegion(region));
    const res = yield call(signupPostRequest, username, password, userInfo);
    const token = res.body.token;
    const userId = res.body.userId;
    const location = {
      latitude: region.latitude,
      longitude: region.longitude,
    };
    yield put(loginSuccess( username, token, userId, location));
}
// --------------------Socket Evnets-------------------------
// ----------------------------------------------------------

// Connect Redux client to socket
function connectSocket(token, userId) {
  const socket = io.connect('http://127.0.0.1:8099/socket', {
    transports: ['websocket'],
  });

  return new Promise((resolve, reject) => {
    socket
      .emit('authenticate', { token })
      .on('authenticated', () => {
        socket.emit('text', 'Client: hello');
        socket.on('text', (text) => {
          console.log(text);
        });
        socket.emit('createRoom', userId);

        resolve(socket);
      })
      .on('unauthorized', (msg) => {
        console.log('unauthorized', JSON.stringify(msg.data));
        reject(JSON.stringify(msg.data));
        });
  });
}

function getNotifications(socket, userId, location) {
  return new Promise((resolve, reject) => {
    socket.emit('getNotifications', userId, location, (notifications) => {
      resolve(notifications);
    });
  });
}

function* fetchNotifications(socket) {
  while (true) {
    const { token, userId, location } = yield take('FETCH_EVENTS');
    console.log("location!!!!!!!!!!!!", location)
    const notifications = yield call(getNotifications, socket, userId, location);
    yield put(loadNotifications(notifications));
  }
}
// ---------Send notification data to socket
function* reportNotification(socket) {
  while (true) {
    const { newNotification } = yield take('REPORT_EVENT');
     socket.emit('reportNotification', newNotification);
  }
}

function sendVote(socket, vote) {
  socket.emit('sendVote', vote);
}

function* voteNotification(socket) {
  while (true) {
    const { vote } = yield take('SERVER_VOTE_EVENT');
    console.log("Vote notification inside saga", vote)
    yield call(sendVote, socket, vote);
  }
}

// ---------Combine sending and receiving data
function* handleIO(socket) {
  // yield fork(read, socket);
  yield fork(fetchNotifications, socket);
  yield fork(reportNotification, socket);
  yield fork(voteNotification, socket);
}

// ---------Define flow of socket
function* flow() {
  while (true) {
    let { token, userId, location } = yield take('SUCCESS');
    const socket = yield call(connectSocket, token, userId);
    console.log('RRRRRRR', userId, location)
    const notifications = yield call(getNotifications, socket, userId, location);
    console.log(')))))))))', notifications)
    yield put(loadNotifications(notifications));
    NavigationActions.mapScreen();
    const task = yield fork(handleIO, socket);
    let action = yield take('LOGOUT_REQUEST');
    yield cancel(task);
    socket.emit('logout');
  }
}

// ---------Export Sagas
export default function* rootSaga() {
  yield fork(flow);
  yield fork(getPosition);
  yield fork(login);
  yield fork(signup);
}
