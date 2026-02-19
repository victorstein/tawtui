export interface CalendarEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: CalendarAttendee[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  calendarId?: string;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

export interface GetEventsOptions {
  calendarId?: string;
  account?: string;
  from: string;
  to: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}
