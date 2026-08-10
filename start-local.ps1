echo "Starting Hardhat local node in the background..."
Start-Process -FilePath "npx.cmd" -ArgumentList "hardhat node" -WindowStyle Minimized

echo "Waiting for node to start (5 seconds)..."
Start-Sleep -Seconds 5

echo "Deploying contracts and auto-updating .env files..."
npx.cmd hardhat run scripts/deploy.js --network localhost

echo "Granting roles..."
npx.cmd hardhat run scripts/grantRoles.js --network localhost

echo "Local environment is ready! You can now start your frontends and backends."
