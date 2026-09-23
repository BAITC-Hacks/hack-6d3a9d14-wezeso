'use client';

import type { ReactNode } from 'react';
import { Badge, type BadgeVariant } from '@cloudflare/kumo/components/badge';
import {
  BookOpen, Certificate, Clock, Compass, MapPin, MonitorPlay, ShieldCheck,
  Tag, Timer, UsersThree, Wrench, type Icon,
} from '@phosphor-icons/react';
import { formatName, typeName, type Event } from '../lib/types';

export type BadgeTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan' | 'neutral';
type BadgeAppearance = { icon: Icon; tone: BadgeTone };

const variants: Record<BadgeTone, BadgeVariant> = {
  blue: 'info', green: 'success', orange: 'warning', red: 'error',
  purple: 'purple', cyan: 'teal-subtle', neutral: 'secondary',
};

/** Shared Kumo badge treatment for statuses and compact metadata. */
export function AppBadge({ children, icon: Icon, tone = 'neutral', className = '' }: {
  children: ReactNode;
  icon: Icon;
  tone?: BadgeTone;
  className?: string;
}) {
  return <Badge variant={variants[tone]} className={`app-badge app-badge--${tone} ${className}`}
    icon={<Icon size={14} weight="fill" aria-hidden="true" />}>
    <span className="app-badge-label" title={typeof children === 'string' ? children : undefined}>{children}</span>
  </Badge>;
}

const activityTypes: Record<string, BadgeAppearance> = {
  course: { icon: BookOpen, tone: 'blue' },
  workshop: { icon: Wrench, tone: 'orange' },
  mentoring: { icon: UsersThree, tone: 'red' },
  certification: { icon: Certificate, tone: 'purple' },
  meetup: { icon: UsersThree, tone: 'red' },
  compliance: { icon: ShieldCheck, tone: 'orange' },
  onboarding: { icon: Compass, tone: 'green' },
};
const activityFormats: Record<string, BadgeAppearance> = {
  online: { icon: MonitorPlay, tone: 'green' },
  offline: { icon: MapPin, tone: 'cyan' },
  self_paced: { icon: Timer, tone: 'orange' },
};

export function ActivityBadges({ event }: { event: Pick<Event, 'type' | 'format' | 'duration_hours'> }) {
  const type = activityTypes[event.type] || { icon: Tag, tone: 'neutral' as const };
  const format = activityFormats[event.format] || { icon: Compass, tone: 'neutral' as const };
  return <div className="badge-group candidate-meta">
    <AppBadge {...type}>{typeName[event.type] || event.type}</AppBadge>
    <AppBadge icon={Clock} tone="purple">{event.duration_hours} ч</AppBadge>
    <AppBadge {...format}>{formatName[event.format] || event.format}</AppBadge>
  </div>;
}
