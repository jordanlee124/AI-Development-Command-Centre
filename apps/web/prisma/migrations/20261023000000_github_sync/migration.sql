-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "description" TEXT,
ADD COLUMN     "htmlUrl" VARCHAR(500),
ADD COLUMN     "isPrivate" BOOLEAN,
ADD COLUMN     "lastSyncAttemptAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "syncFailures" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "github_branches" (
    "repositoryId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "headSha" VARCHAR(64) NOT NULL,
    "protected" BOOLEAN NOT NULL,

    CONSTRAINT "github_branches_pkey" PRIMARY KEY ("repositoryId","name")
);

-- CreateTable
CREATE TABLE "github_commits" (
    "repositoryId" UUID NOT NULL,
    "sha" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" VARCHAR(255),
    "authorLogin" VARCHAR(100),
    "committedAt" TIMESTAMPTZ(3) NOT NULL,
    "url" VARCHAR(500) NOT NULL,

    CONSTRAINT "github_commits_pkey" PRIMARY KEY ("repositoryId","sha")
);

-- CreateTable
CREATE TABLE "github_pull_requests" (
    "repositoryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "draft" BOOLEAN NOT NULL,
    "authorLogin" VARCHAR(100),
    "headRef" VARCHAR(255) NOT NULL,
    "baseRef" VARCHAR(255) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "mergedAt" TIMESTAMPTZ(3),
    "reviewStatus" VARCHAR(30),
    "approvals" INTEGER,
    "changesRequested" INTEGER,
    "reviewsRequested" INTEGER,

    CONSTRAINT "github_pull_requests_pkey" PRIMARY KEY ("repositoryId","number")
);

-- CreateTable
CREATE TABLE "github_issues" (
    "repositoryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "authorLogin" VARCHAR(100),
    "comments" INTEGER NOT NULL,
    "labels" TEXT[],
    "url" VARCHAR(500) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "github_issues_pkey" PRIMARY KEY ("repositoryId","number")
);

-- CreateTable
CREATE TABLE "github_workflow_runs" (
    "repositoryId" UUID NOT NULL,
    "githubId" BIGINT NOT NULL,
    "name" VARCHAR(255),
    "title" TEXT NOT NULL,
    "branch" VARCHAR(255),
    "headSha" VARCHAR(64) NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "conclusion" VARCHAR(30),
    "runNumber" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "githubCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "github_workflow_runs_pkey" PRIMARY KEY ("repositoryId","githubId")
);

-- CreateIndex
CREATE INDEX "github_commits_repositoryId_committedAt_idx" ON "github_commits"("repositoryId", "committedAt");

-- CreateIndex
CREATE INDEX "github_pull_requests_repositoryId_githubUpdatedAt_idx" ON "github_pull_requests"("repositoryId", "githubUpdatedAt");

-- CreateIndex
CREATE INDEX "github_issues_repositoryId_githubUpdatedAt_idx" ON "github_issues"("repositoryId", "githubUpdatedAt");

-- CreateIndex
CREATE INDEX "github_workflow_runs_repositoryId_githubCreatedAt_idx" ON "github_workflow_runs"("repositoryId", "githubCreatedAt");

-- AddForeignKey
ALTER TABLE "github_branches" ADD CONSTRAINT "github_branches_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_commits" ADD CONSTRAINT "github_commits_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_workflow_runs" ADD CONSTRAINT "github_workflow_runs_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: Prisma schema cannot express CHECK constraints.
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_sync_failures_non_negative" CHECK ("syncFailures" >= 0);
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_state" CHECK ("state" IN ('open', 'closed', 'merged'));
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_review_counts_non_negative" CHECK ("approvals" >= 0 AND "changesRequested" >= 0 AND "reviewsRequested" >= 0);
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_state" CHECK ("state" IN ('open', 'closed'));
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_comments_non_negative" CHECK ("comments" >= 0);
