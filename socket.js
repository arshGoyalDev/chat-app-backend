import Message from "./models/MessagesModel.js";
import Group from "./models/GroupModel.js";

import User from "./models/UserModel.js";

import { decryptMessage, encryptMessage } from "./cryptr/index.js";

const setupSocket = (io) => {
  const userSocketMap = new Map();

  const disconnect = async (socket) => {
    console.log(`${socket.handshake.query.userId} is offline`);

    await User.findByIdAndUpdate(
      socket.handshake.query.userId,
      {
        userOnline: false,
      },
      { new: true, runValidators: true }
    );

    for (const [userId, socketId] of userSocketMap.entries()) {
      if (socketId === socket.id) {
        userSocketMap.delete(userId);
        break;
      }
    }
  };

  const sendMessage = async (message) => {
    const { content } = message;

    const senderSocketId = userSocketMap.get(message.sender);
    const recipientSocketId = userSocketMap.get(message.recipient);

    const createdMessage = await Message.create({
      ...message,
      content: encryptMessage(content),
    });

    let messageData = await Message.findById(createdMessage._id)
      .populate("sender", "id email firstName lastName profilePic status")
      .populate("recipient", "id email firstName lastName profilePic status");

    messageData.content = decryptMessage(messageData.content);

    if (recipientSocketId) {
      io.to(recipientSocketId).emit("receiveMessage", messageData);
    }

    if (senderSocketId) {
      io.to(senderSocketId).emit("receiveMessage", messageData);
    }
  };

  const sendGroupMessage = async (message) => {
    const { groupId, content, messageType, fileUrl, sender } = message;

    const createdMessage = await Message.create({
      sender,
      recipient: null,
      content: encryptMessage(content),
      messageType,
      timeStamp: new Date(),
      fileUrl,
    });

    let messageData = await Message.findById(createdMessage._id)
      .populate(
        "sender",
        "id email profilePic firstName lastName status userOnline"
      )
      .exec();

    messageData.content = decryptMessage(messageData.content);

    await Group.findByIdAndUpdate(groupId, {
      $push: { messages: createdMessage._id },
    });

    const group = await Group.findById(groupId).populate("groupMembers");

    const finalData = { ...messageData._doc, groupId: group._id };

    if (group && group.groupMembers) {
      group.groupMembers.forEach((member) => {
        const memberSocketId = userSocketMap.get(member._id.toString());
        if (memberSocketId) {
          io.to(memberSocketId).emit("receiveGroupMessage", finalData);
        }
      });

      const adminSocketId = userSocketMap.get(group.groupAdmin.toString());
      if (adminSocketId) {
        io.to(adminSocketId).emit("receiveGroupMessage", finalData);
      }
    }
  };

  const deleteGroup = async (groupId) => {
    const group = await Group.findById(groupId).populate("groupAdmin");

    if (group.messages && group.messages.length > 0) {
      await Message.deleteMany({
        _id: { $in: group.messages },
      });
    }

    const finalData = {
      groupId: group._id,
      groupName: group.groupName,
      groupAdmin: `${groupAdmin.firstName} ${groupAdmin.lastName}`,
    };

    await Group.findByIdAndDelete(groupId);

    if (group.groupMembers) {
      group.groupMembers.forEach((memberId) => {
        const memberSocketId = userSocketMap.get(memberId.toString());
        if (memberSocketId) {
          io.to(memberSocketId).emit("groupDeleted", finalData);
        }
      });
    }

    const adminSocketId = userSocketMap.get(group.groupAdmin._id.toString());
    if (adminSocketId) {
      io.to(adminSocketId).emit("groupDeleted", finalData);
    }
  };

  const leaveGroup = async (data) => {
    const { groupId, leavingMember } = data;

    const group = await Group.findById(groupId).populate("groupMembers");

    const groupMembers = group.groupMembers.filter((member) =>
      member._id.toString() !== leavingMember._id
    );

    const leavingMessage = await Message.create({
      sender: leavingMember._id,
      recipient: null,
      content: encryptMessage(
        `${leavingMember.firstName} ${leavingMember.lastName} left the group`
      ),
      messageType: "leaving",
      timeStamp: new Date(),
      fileUrl: null,
    });

    const messageData = await Message.findById(leavingMessage._id)
      .populate(
        "sender",
        "id email profilePic firstName lastName status userOnline"
      )
      .exec();

    await Group.findByIdAndUpdate(groupId, {
      groupMembers: groupMembers,
      $push: { messages: leavingMessage._id },
    });

    const updatedGroup = await Group.findById(groupId)
      .populate("groupMembers")
      .populate("groupAdmin");

    const finalData = {
      messageData: {
        ...messageData,
        content: decryptMessage(messageData.content),
      },
      updatedGroup,
      leavingMemberId: leavingMember._id,
    };

    if (groupMembers) {
      updatedGroup.groupMembers.forEach((member) => {
        const memberSocketId = userSocketMap.get(member._id.toString());
        if (memberSocketId) {
          io.to(memberSocketId).emit("memberLeft", finalData);
        }
      });
    }

    const adminSocketId = userSocketMap.get(
      updatedGroup.groupAdmin._id.toString()
    );
    if (adminSocketId) {
      io.to(adminSocketId).emit("memberLeft", finalData);
    }

    const leavingMemberSocketId = userSocketMap.get(
      leavingMember._id.toString()
    );
    if (leavingMemberSocketId) {
      io.to(leavingMemberSocketId).emit("memberLeft", finalData);
    }
  };

  io.on("connection", async (socket) => {
    const userId = socket.handshake.query.userId;

    if (userId) {
      await User.findByIdAndUpdate(
        userId,
        {
          userOnline: true,
        },
        { new: true, runValidators: true }
      );

      userSocketMap.set(userId, socket.id);
    } else {
      console.log("No userId provided");
    }

    socket.on("leaveGroup", leaveGroup);
    socket.on("deleteGroup", deleteGroup);
    socket.on("sendMessage", sendMessage);
    socket.on("sendGroupMessage", sendGroupMessage);
    socket.on("disconnect", () => disconnect(socket));
  });
};

export default setupSocket;
