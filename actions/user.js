"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateAIInsights } from "./dashboard";
import { checkUser } from "@/lib/checkUser";
/**
 * Updates user profile and generates industry insights if needed.
 * Generates AI insights OUTSIDE the transaction to avoid timeouts.
 */
export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // 1. Ensure user exists in DB (creates them with email/name if missing)
  const user = await checkUser();
  if (!user) throw new Error("User registration failed");

  try {
    // 2. Check for industry insights
    let industryInsight = await db.industryInsight.findUnique({
      where: { industry: data.industry },
    });

    let insights;
    if (!industryInsight) {
      insights = await generateAIInsights(data.industry);
      insights.demandLevel = insights.demandLevel.toUpperCase();
      insights.marketOutlook = insights.marketOutlook.toUpperCase();
    }

    // 3. Transaction for fast DB writes
    const result = await db.$transaction(async (tx) => {
      if (!industryInsight && insights) {
        industryInsight = await tx.industryInsight.create({
          data: {
            industry: data.industry,
            salaryRanges: insights.salaryRanges,
            growthRate: insights.growthRate,
            demandLevel: insights.demandLevel,
            topSkills: insights.topSkills,
            marketOutlook: insights.marketOutlook,
            keyTrends: insights.keyTrends,
            recommendedSkills: insights.recommendedSkills,
            nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }

      // 4. Update the existing user record
      const updatedUser = await tx.user.update({
        where: { clerkUserId: userId },
        data: {
          industry: data.industry,
          experience: data.experience,
          bio: data.bio,
          skills: data.skills,
        },
      });

      return { updatedUser, industryInsight };
    });

    revalidatePath("/");
    return { success: true, ...result };
  } catch (error) {
    console.error("Error updating user and industry:", error);
    throw new Error("Failed to update profile: " + error.message);
  }
}

/**
 * Checks if the user has completed onboarding.
 */
export async function getUserOnboardingStatus() {
  try {
    const { userId } = await auth();
    
    // If Clerk isn't initialized or user isn't logged in
    if (!userId) {
      return { isOnboarded: false }; 
    }

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
      select: { industry: true },
    });

    return { 
      isOnboarded: !!user?.industry 
    };
  } catch (error) {
    // Log the error so you can see it in the VS Code terminal
    console.error("Onboarding Status Error:", error);
    
    // Don't throw a generic error during debugging; return a safe state or the real error
    return { isOnboarded: false, error: "Database connection failed" };
  }
}