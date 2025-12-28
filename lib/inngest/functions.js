import { db } from "@/lib/prisma";
import { inngest } from "./client";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

export const generateIndustryInsights = inngest.createFunction(
  { name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" }, // Run every Sunday at midnight
  async ({ step }) => {
    // Step 1: Fetch all industries from DB
    const industries = await step.run("Fetch industries", async () => {
      return await db.industryInsight.findMany({
        select: { industry: true },
      });
    });

    // Step 2: Loop through each industry
    for (const { industry } of industries) {
      const prompt = `
        Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:
        {
          "salaryRanges": [
            { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
          ],
          "growthRate": number,
          "demandLevel": "High" | "Medium" | "Low",
          "topSkills": ["skill1", "skill2"],
          "marketOutlook": "Positive" | "Neutral" | "Negative",
          "keyTrends": ["trend1", "trend2"],
          "recommendedSkills": ["skill1", "skill2"]
        }

        IMPORTANT: Return ONLY the JSON. No additional text, notes, or markdown formatting.
        Include at least 5 common roles for salary ranges.
        Growth rate should be a percentage.
        Include at least 5 skills and trends.
      `;

      // Step 3: Generate AI Response
      const res = await step.ai.wrap(
        "gemini",
        async (p) => {
          return await model.generateContent(p);
        },
        prompt
      );

      // Step 4: Extract clean JSON text
      const text = res.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

      let insights;
      try {
        insights = JSON.parse(cleanedText);
      } catch (err) {
        console.error(`❌ Failed to parse JSON for ${industry}:`, cleanedText);
        continue; // Skip this industry if AI response is malformed
      }

      // Step 5: Normalize Enum Values (fix for Prisma enums)
      const normalizeEnum = (value, allowed, fallback) => {
        const v = value?.toUpperCase();
        return allowed.includes(v) ? v : fallback;
      };

      insights.demandLevel = normalizeEnum(insights.demandLevel, ["HIGH", "MEDIUM", "LOW"], "MEDIUM");
      insights.marketOutlook = normalizeEnum(insights.marketOutlook, ["POSITIVE", "NEUTRAL", "NEGATIVE"], "NEUTRAL");

      // Step 6: Update IndustryInsight in DB
      await step.run(`Update ${industry} insights`, async () => {
        await db.industryInsight.update({
          where: { industry },
          data: {
            salaryRanges: insights.salaryRanges || [],
            growthRate: insights.growthRate || 0,
            demandLevel: insights.demandLevel,
            topSkills: insights.topSkills || [],
            marketOutlook: insights.marketOutlook,
            keyTrends: insights.keyTrends || [],
            recommendedSkills: insights.recommendedSkills || [],
            lastUpdated: new Date(),
            nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
          },
        });
      });
    }
  }
);
