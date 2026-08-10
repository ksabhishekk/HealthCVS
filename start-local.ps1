echo "Assuming Ganache GUI is running on port 8545..."

echo "Deploying contracts to Ganache GUI and auto-updating .env files..."
npx.cmd hardhat run scripts/deploy.js --network localhost

echo "Granting roles..."
npx.cmd hardhat run scripts/grantRoles.js --network localhost

echo "Deployment complete! Your Ganache GUI workspace now has the contracts."
echo "Since Ganache GUI saves your workspace automatically, you only need to run this script if you click the 'Reset' button in Ganache (the trash can icon)."
