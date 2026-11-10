import { useId, type ReactNode } from 'react';
import type { NotificationDto } from '../../api/notifications';

interface NotificationRecipe {
  article: string; unread: string; heading: string; labels: string; footer: string;
  priority?: string; preview?: string;
}

/** Presentation only: date, actions and mutation feedback are supplied by the caller. */
export function NotificationContent({ notification, headingLevel, variant = 'inbox', date, actions, feedback, recipe }: {
  notification: Pick<NotificationDto, 'id' | 'title' | 'body' | 'read' | 'priority' | 'createdAt'>;
  headingLevel: 2 | 3; variant?: 'inbox' | 'preview';
  date: { text: string; dateTime?: string }; actions?: ReactNode; feedback?: ReactNode; recipe: NotificationRecipe;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <article aria-labelledby={id} className={`${recipe.article}${notification.read ? '' : ` ${recipe.unread}`}`}>
    <div className={recipe.heading}>
      <Heading id={id}>{notification.title}</Heading>
      <div className={recipe.labels}><span>{notification.read ? 'Leída' : 'No leída'}</span>
        {notification.priority === 'HIGH' ? <span className={recipe.priority}>Prioridad alta</span> : null}
      </div>
    </div>
    <p className={variant === 'preview' ? recipe.preview : undefined}>{notification.body}</p>
    <div className={recipe.footer}>
      {date.dateTime ? <time dateTime={date.dateTime}>{date.text}</time> : <span>{date.text}</span>}
      {actions}
    </div>
    {feedback}
  </article>;
}
