-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentSource" AS ENUM ('CLAUDE_CODE', 'CODEX');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "localPath" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "owner" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "githubId" BIGINT,
    "defaultBranch" VARCHAR(255),
    "lastSyncedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "milestoneId" UUID,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "source" "AgentSource" NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "projectId" UUID,
    "cwd" TEXT,
    "gitBranch" VARCHAR(255),
    "title" TEXT,
    "sourcePath" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "lastEventAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "skippedRecordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "role" VARCHAR(50),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "sourceLine" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "dedupeKey" VARCHAR(300),
    "metadata" JSONB,
    "projectId" UUID,
    "repositoryId" UUID,
    "taskId" UUID,
    "agentSessionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_localPath_key" ON "projects"("localPath");

-- CreateIndex
CREATE INDEX "projects_archivedAt_idx" ON "projects"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_githubId_key" ON "repositories"("githubId");

-- CreateIndex
CREATE INDEX "repositories_projectId_idx" ON "repositories"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_owner_name_key" ON "repositories"("owner", "name");

-- CreateIndex
CREATE INDEX "milestones_projectId_status_idx" ON "milestones"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_projectId_title_key" ON "milestones"("projectId", "title");

-- CreateIndex
CREATE INDEX "tasks_projectId_status_idx" ON "tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");

-- CreateIndex
CREATE INDEX "agent_sessions_projectId_startedAt_idx" ON "agent_sessions"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_sessions_lastEventAt_idx" ON "agent_sessions"("lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_source_externalId_key" ON "agent_sessions"("source", "externalId");

-- CreateIndex
CREATE INDEX "agent_events_sessionId_occurredAt_idx" ON "agent_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_sessionId_externalId_key" ON "agent_events"("sessionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_eventId_key" ON "usage_records"("eventId");

-- CreateIndex
CREATE INDEX "usage_records_sessionId_idx" ON "usage_records"("sessionId");

-- CreateIndex
CREATE INDEX "usage_records_occurredAt_idx" ON "usage_records"("occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_model_occurredAt_idx" ON "usage_records"("model", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_dedupeKey_key" ON "activity_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "activity_events_occurredAt_idx" ON "activity_events"("occurredAt");

-- CreateIndex
CREATE INDEX "activity_events_projectId_occurredAt_idx" ON "activity_events"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_events_type_occurredAt_idx" ON "activity_events"("type", "occurredAt");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "agent_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: Prisma schema cannot express CHECK constraints.
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tokens_non_negative" CHECK (
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND "cacheReadTokens" >= 0
    AND "cacheWriteTokens" >= 0 AND "reasoningTokens" >= 0
);
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_skipped_non_negative" CHECK ("skippedRecordCount" >= 0);
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_source_line_positive" CHECK ("sourceLine" >= 1);
