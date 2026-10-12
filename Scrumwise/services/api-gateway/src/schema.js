// The GraphQL schema: everything the browser can ask for or change.
import { buildSchema } from 'graphql';

export const schema = buildSchema(/* GraphQL */ `
  scalar JSON
  type User { id: ID!, name: String!, email: String!, title: String, hue: Int, timeZone: String, hour24: Boolean, home: String }
  type Session { token: String!, user: User! }

  type Member { user: ID!, role: String! }
  type Column { id: ID!, name: String!, cat: String! }
  type Space { key: ID!, name: String!, lead: ID, hue: Int, members: [Member!]!, columns: [Column!]!, issueCount: Int }
  type Sprint { id: ID!, project: ID!, name: String!, goal: String, start: String, end: String, state: String! }
  type Comment { id: ID!, by: ID, byName: String, text: String!, at: String, parent: ID }
  type HistoryEntry { by: ID, byName: String, text: String, at: String }
  type Issue {
    key: ID!, project: ID!, projectName: String, type: String!, title: String!, desc: String, status: String!, statusName: String, statusCat: String, priority: String!, points: Int,
    assignee: ID, reporter: ID, sprint: ID, labels: [String!]!, comments: [Comment!]!, history: [HistoryEntry!]!, createdAt: String, updatedAt: String
  }
  "Everything a space's pages need, in one request."
  type SpaceData { project: Space!, sprints: [Sprint!]!, issues: [Issue!]! }

  type Reaction { emoji: String!, user: ID! }
  "The message being replied to. If it was deleted, only the id is left."
  type ReplyRef { id: ID!, fromName: String, text: String, deleted: Boolean }
  type Message { id: ID!, channel: ID!, from: ID!, fromName: String, text: String!, at: String, editedAt: String, reactions: [Reaction!]!, replyTo: ReplyRef }
  "When a member last read a conversation."
  type Read { user: ID!, at: String! }
  type Channel {
    id: ID!, kind: String!, project: ID, name: String, about: String, private: Boolean, members: [ID!]!,
    "For a direct message: the other person."
    other: ID, unread: Int!, last: Message, reads: [Read!]!,
    "Your own settings for this conversation, and whether you may delete it."
    muted: Boolean!, hidden: Boolean!, canDelete: Boolean!
  }

  type NotificationLink { project: ID, channelId: ID, issueKey: ID }
  type Notification { id: ID!, kind: String!, text: String!, detail: String, link: NotificationLink, read: Boolean!, at: String }
  type Notifications { unread: Int!, list: [Notification!]! }

  input IssueInput {
    type: String, title: String, desc: String, status: String, priority: String, points: Int,
    assignee: ID, assigneeName: String, sprint: ID, labels: [String!]
  }
  input ColumnInput { id: ID, name: String!, cat: String }
  input SprintInput { name: String!, goal: String, start: String!, end: String! }
  input ChannelInput { project: ID!, name: String!, about: String, private: Boolean, members: [ID!] }

  type Query {
    me: User!
    users: [User!]!
    spaces: [Space!]!
    space(key: ID!): SpaceData!
    "Open issues assigned to you, in every space."
    myIssues: [Issue!]!
    channels(project: ID!): [Channel!]!
    channel(id: ID!): Channel!
    "The messages of a conversation. Asking for them marks the conversation as read."
    messages(channel: ID!): [Message!]!
    directMessages: [Channel!]!
    notifications: Notifications!
    "In-product switches (message, channel, board, assigned, comment), email, emailKinds, spaces and digests. See /api/docs."
    notificationSettings: JSON!
  }

  type Mutation {
    signup(name: String!, email: String!, password: String!, title: String): Session!
    login(email: String!, password: String!): Session!
    updateProfile(name: String, title: String, timeZone: String, hour24: Boolean, home: String, currentPassword: String, newPassword: String): Session!

    createSpace(name: String!, key: String!): Space!
    addMember(space: ID!, user: ID!, role: String): Space!
    setMemberRole(space: ID!, user: ID!, role: String!): Space!
    removeMember(space: ID!, user: ID!): Space!
    setColumns(space: ID!, columns: [ColumnInput!]!): Space!

    createIssue(space: ID!, input: IssueInput!): Issue!
    updateIssue(key: ID!, input: IssueInput!): Issue!
    deleteIssue(key: ID!): Boolean!
    addComment(issue: ID!, text: String!, parent: ID): Issue!
    "Deletes a comment and every reply under it."
    deleteComment(issue: ID!, id: ID!): Issue!

    createSprint(space: ID!, input: SprintInput!): Sprint!
    updateSprint(id: ID!, input: SprintInput!): Sprint!
    startSprint(id: ID!): Sprint!
    "Open issues move to the sprint given in moveTo, or to the backlog."
    completeSprint(id: ID!, moveTo: ID): Sprint!
    deleteSprint(id: ID!): Boolean!

    createChannel(input: ChannelInput!): Channel!
    "Pass replyTo to answer a particular message; it is then quoted above yours."
    sendMessage(channel: ID!, text: String!, replyTo: ID): Message!
    "Only the sender can edit or delete a message. Deleting removes it for everyone."
    editMessage(channel: ID!, id: ID!, text: String!): Message!
    deleteMessage(channel: ID!, id: ID!): Boolean!
    "Adds your reaction, or removes it if you had already added the same one."
    reactToMessage(channel: ID!, id: ID!, emoji: String!): Message!
    markRead(channel: ID!): Boolean!
    "Stop (or resume) notifications for a conversation. Only affects you."
    muteConversation(channel: ID!, muted: Boolean!): Channel!
    "Keep a conversation out of your sidebar until someone writes in it again. Only affects you."
    hideConversation(channel: ID!, hidden: Boolean!): Channel!
    "A direct message is deleted for you only. A channel is deleted for everyone, by its creator."
    deleteConversation(channel: ID!): Boolean!
    "Finds your conversation with a person, creating it the first time."
    openDirectMessage(user: ID!): Channel!

    "Marks one notification as read, or all of them when no id is given."
    readNotifications(id: ID): Boolean!
    "Choose what you are notified about. Send only the parts you want to change."
    setNotificationSettings(input: JSON!): JSON!
  }
`);
