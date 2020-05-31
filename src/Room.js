import { createEmitter } from "./emitter";
import * as log from "./log";

export class Room {
  #client;
  #appName;
  #roomName;
  #isReady;
  #emitter;
  #record;
  #participants;
  constructor(client, appName, roomName) {
    this.#client = client;
    this.#appName = appName;
    this.#roomName = roomName;
    this.#isReady = false;
    this.#emitter = createEmitter();
    this._connect();
  }

  async _connect() {
    await this.#client.whenReady();

    const recordName = `${this.#appName}-${this.#roomName}/_room_data`;
    this.#record = this.#client.getRecord(recordName);
    await this.#record.whenReady();

    // create participants list if it doesn't exist
    if (!this.#record.get("participants")) {
      this.#record.set("participants", {});
      this.#record.set("host", false);
    }
    await this.#record.whenReady();

    this.#record.subscribe("participants", (data) => {
      log.debug("subscribe");
      this.#participants = data;
    });

    // manage presence
    // await this._markMissing();
    this.#client.presenceSubscribe(this._onPresenceHandler.bind(this));

    this.#isReady = true;
    this.#emitter.emit("ready");

    setInterval(this._displayParticipants.bind(this), 1000);
  }

  whenReady(cb = () => {}) {
    if (this.#isReady) {
      cb();
      return Promise.resolve();
    } else {
      this.#emitter.once("ready", cb);
      return new Promise((resolve) => {
        this.#emitter.once("ready", resolve);
      });
    }
  }

  join() {
    if (!this.#record.get(`participants.${this.#client.name()}`)) {
      this.#record.set(`participants.${this.#client.name()}`, {});
    }
    // this.#record.set(`participants.${this.#client.name()}.isMissing`, false);
    this._chooseHost();
  }

  async leave() {
    this.#record.set(`participants.${this.#client.name()}`, undefined);

    await this._chooseHost();
  }

  contains(username) {
    const participants = this.#record.get(`participants`);
    return Object.keys(participants).includes(username);
  }

  async clearMissing() {
    const onLine = await this.#client.getAllClients();
    const participants = this.#record.get("participants");
    for (const key in participants) {
      if (!onLine.includes(key)) {
        this.#record.set(`participants.${key}`, undefined);
      }
    }
    this._chooseHost();
  }

  _onPresenceHandler(username, isLoggedIn) {
    console.log(username, isLoggedIn ? "arrived" : "left");
    if (!this.contains(username)) return;

    if (isLoggedIn) {
      log.warn(`Participant ${username} returned.`);
      this._chooseHost();
    }
    if (!isLoggedIn) {
      log.warn(`Participant ${username} went missing.`);
      this._chooseHost();
    }
  }

  //   async _markMissing() {
  //     const onLine = await this.#client.getAllClients();
  //     const participants = this.#record.get("participants");
  //     for (const participant in participants) {
  //       const isMissing = !onLine.includes(participant);
  //       this.#record.set(`participants.${participant}.isMissing`, isMissing);
  //       if (isMissing && this.#record.get("host") === participant) {
  //         this.#record.set(`host`, false);
  //       }
  //     }
  //   }

  async _chooseHost() {
    let host = this.#record.get("host");
    const participants = this.#record.get("participants");
    const online = await this.#client.getAllClients();
    for (const participant in participants) {
      const isMissing = !online.includes(participant);
      //   this.#record.set(`participants.${participant}.isMissing`, isMissing);
      participants[participant].isMissing = isMissing;
      if (isMissing && host === participant) {
        //this.#record.set(`host`, false);
        host = false;
      }
    }
    if (!online.includes(host)) host = false;

    if (host) return;

    let newHost;
    for (const [key, value] of Object.entries(participants)) {
      if (value.isMissing === false) {
        newHost = key;
        break;
      }
    }

    // const newHost = Object.values(participants).find((p) => {
    //   console.log("p", p);
    //   return p.isMissing === false;
    // });

    console.log("chose host", newHost);
    if (!newHost) {
      log.debug("couldn't find a host");
    }

    // have only the new host set host so that multiple clients
    // don't try to set the host at once, causing problems with DS
    if (newHost === this.#client.name()) {
      log.debug("!!!!!Setting new host:", newHost);
      this.#record.set("host", newHost);
    }
  }

  //   async _chooseHost_old() {
  //     await this._markMissing();

  //     // load participants
  //     await this.#record.whenReady();
  //     const participants = this.#record.get("participants");
  //     if (Object.keys(participants).length === 0) {
  //       return log.warn(
  //         "There are no participants in this room. Hopefully this is the last particpant to leave."
  //       );
  //     }

  //     // count hosts
  //     let hostsFound = 0;
  //     for (const name in participants) {
  //       if (participants[name].isHost === true) hostsFound++;
  //     }

  //     if (hostsFound === 0) {
  //       log.log("Found 0 hosts!");
  //       // record/participants contains clients that are in the room
  //       // but some may be (temporarily) disconnected and shouldn't be made host
  //       // so choose host from intersection of inRoom and onLine
  //       const inRoom = Object.keys(participants);
  //       const onLine = await this.#client.getAllClients();

  //       let inRoomOnLine = inRoom.filter((user) => onLine.includes(user));
  //       const newHostName = inRoomOnLine.sort()[0];
  //       // @todo, maybe only set host if this client the new host
  //       log.debug("!!!!!Setting new host:", newHostName);
  //       this.#record.set(`participants.${newHostName}.isHost`, true);
  //     }

  //     if (hostsFound > 1) {
  //       return log.error(`Something went wrong. Found ${hostsFound} hosts!`);
  //     }
  //   }

  async _displayParticipants() {
    let el = document.getElementById("_sharedParticipants");
    if (!el) {
      el = document.createElement("div");
      el.id = "_sharedParticipants";
      el.style.fontFamily = "monospace";
      document.body.appendChild(el);
    }

    const online = await this.#client.getAllClients();

    const names = Object.keys(this.#participants).sort();
    let output = `${this.#appName}-${this.#roomName}: `;
    for (const name of names) {
      const shortName = name.substr(-4);
      const isHost = this.#record.get(`host`) === name ? "H" : "";
      const isMissing = !online.includes(name) ? "!" : "";

      const isMe = this.#client.name() === name ? "M" : "";
      output += `${shortName}:${isHost}${isMe}${isMissing} `;
    }
    // console.log.log(output);
    el.textContent = output;
  }
}
// function delay(ms) {
//   return new Promise((r) => {
//     setTimeout(r, ms);
//   });
// }
