// Mainnet deployment script for TaskPay
// Deploys to BOT Chain mainnet (chain 677)
const ethers = require('ethers');
const fs = require('fs');

async function deploy() {
  const PRIVATE_KEY = '02972ecf93402287733bb4d5b93f6dbc52dbca3493d09d4fb9b8221391a88a2b';
  const RPC_URL = 'https://rpc.botchain.ai';
  const CHAIN_ID = 677;

  // Connect to BOT Chain mainnet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  
  console.log(`Deployer address: ${signer.address}`);
  console.log(`Chain ID: ${CHAIN_ID}`);

  // Get signer balance
  const balance = await provider.getBalance(signer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} BOT`);

  if (balance === 0n) {
    throw new Error('Deployer wallet has no BOT balance!');
  }

  // Load compiled contract from forge artifacts
  let compiled;
  try {
    const artifactPath = './out/TaskPay.sol/TaskPay.json';
    compiled = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to read compiled contract artifact`);
    console.error(e.message);
    throw e;
  }

  // Ensure bytecode starts with 0x
  let bytecode = compiled.bytecode.object;
  if (!bytecode.startsWith('0x')) {
    bytecode = '0x' + bytecode;
  }
  const abi = compiled.abi;

  console.log(`Bytecode length: ${bytecode.length} chars`);
  console.log(`ABI methods: ${abi.filter(m => m.type === 'function').length}`);

  // Constructor args
  const oracle = signer.address; // Deployer is oracle
  const challengeWindow = 259200; // 3 days
  const seniorArbiterWindow = 86400; // 1 day

  console.log(`\nDeploying TaskPay v3 to BOT Chain Mainnet with:`);
  console.log(`  oracle: ${oracle}`);
  console.log(`  challengeWindow: ${challengeWindow}s (3 days)`);
  console.log(`  seniorArbiterWindow: ${seniorArbiterWindow}s (1 day)`);

  // Create contract factory
  const ContractFactory = new ethers.ContractFactory(abi, bytecode, signer);

  // Deploy
  console.log('\n⏳ Deploying...');
  const contract = await ContractFactory.deploy(oracle, challengeWindow, seniorArbiterWindow);
  const deployTx = contract.deploymentTransaction();
  
  console.log(`Transaction hash: ${deployTx.hash}`);
  console.log('Waiting for confirmation...');
  
  const receipt = await deployTx.wait(1);
  
  if (!receipt) {
    throw new Error('Deployment transaction failed or was reverted');
  }
  
  console.log(`\n✅ TaskPay deployed successfully!`);
  console.log(`Contract address: ${receipt.contractAddress}`);
  console.log(`Block number: ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  console.log(`Transaction fee: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} BOT`);
  
  // Output for .env
  console.log(`\n📝 Add to .env.mainnet:`);
  console.log(`CONTRACT_ADDRESS=${receipt.contractAddress}`);
}

deploy().catch(err => {
  console.error('\n❌ Deployment failed:');
  console.error(err.message);
  process.exit(1);
});
