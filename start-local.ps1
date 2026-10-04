echo "Assuming Ganache GUI is running on port 8545..."

echo "Deploying contracts, loading the package-rate card, granting roles and updating .env files..."
npx.cmd hardhat run scripts/deploy.js --network localhost
if ($LASTEXITCODE -ne 0) { echo "Deployment failed - see the error above."; exit 1 }

echo ""
echo "Deployment complete. Next:"
echo "  1. Claim IDs restart at 1: cd insurance-portal/backend; node scripts/archiveStaleClaims.js --apply"
echo "  2. Restart both backends and the AI service (they read contract addresses at startup)."
echo "  3. Optional demo data: cd insurance-portal/backend; node scripts/seedDemoPolicies.js --email you@gmail.com"
echo "Ganache saves the workspace, so you only need to run this again after resetting Ganache."
