export interface QQPayload<T = unknown> {
  id?: string;
  op: number;
  d?: T;
  s?: number;
  t?: string;
}

export interface QQValidationRequest {
  plain_token: string;
  event_ts: string;
}

export interface QQMessageEvent {
  id: string;
  content: string;
  timestamp?: string;
  group_openid?: string;
  author?: {
    user_openid?: string;
    member_openid?: string;
    member_role?: string;
    bot?: boolean;
  };
}

export type MessageTarget =
  | { type: "group"; groupOpenid: string }
  | { type: "c2c"; userOpenid: string };

export type QQImageSource =
  | { url: string }
  | { fileData: string };

export type OutgoingQQMessage =
  | { type: "text"; content: string }
  | { type: "markdown"; content: string }
  | { type: "media"; fileInfo: string };
