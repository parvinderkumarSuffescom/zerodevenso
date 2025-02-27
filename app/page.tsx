"use client";
import {
  addressToEmptyAccount,
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { parseUnits } from "viem";
import { EnsoClient } from "@ensofinance/sdk";

import { getValidatorPluginInstallModuleData } from "@zerodev/sdk";
import {
  generatePrivateKey,
  mnemonicToAccount,
  privateKeyToAccount,
} from "viem/accounts";
import { english, generateMnemonic } from "viem/accounts";
import {
  PasskeyValidatorContractVersion,
  WebAuthnMode,
  toPasskeyValidator,
  toWebAuthnKey,
} from "@zerodev/passkey-validator";

import React, { useEffect, useState } from "react";
import { createPublicClient, http, Transport, Chain, zeroAddress } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";

import {
  createWeightedKernelAccountClient,
  getRecoveryFallbackActionInstallModuleData
} from "@zerodev/weighted-validator";
import {
  createWeightedECDSAValidator,
  getRecoveryAction,
} from "@zerodev/weighted-ecdsa-validator";
import {
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { toSudoPolicy } from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";

const ensoClient = new EnsoClient({
  apiKey: "dc6a0639-3f79-4891-a0fd-5f0cf3033943",
});

const SEPOLIA_PROJECT_ID = "459dfa57-b4fc-46e4-8e57-df544ead38f9";

const SEPOLIA_BUNDLER_URL = `https://rpc.zerodev.app/api/v2/bundler/${SEPOLIA_PROJECT_ID}`;
const SEPOLIA_PAYMASTER_URL = `https://rpc.zerodev.app/api/v2/paymaster/${SEPOLIA_PROJECT_ID}`;
const SEPOLIA_PASSKEY_SERVER_URL = `https://passkeys.zerodev.app/api/v3/${SEPOLIA_PROJECT_ID}`;

const USDC_CONTRACT_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_CONTRACT_ADDRESS = "0xdac17f958d2ee523a2206206994597c13d831ec7";

const SEPOLIA = sepolia;
const publicClient = createPublicClient({
  transport: http(SEPOLIA_BUNDLER_URL),
  chain: sepolia,
});

const paymasterClient = createZeroDevPaymasterClient({
  chain: sepolia,
  transport: http(SEPOLIA_PAYMASTER_URL),
});
const entryPoint = getEntryPoint("0.7");

const sepoliaZeroDevPaymasterClient = createZeroDevPaymasterClient({
  chain: SEPOLIA,
  transport: http(SEPOLIA_PAYMASTER_URL),
});

let sepoliaKernelAccount: any;
let sepoliaKernelClient: any;
let opSepoliaKernelAccount: any;
let opSepoliaKernelClient: any;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [accountAddress, setAccountAddress] = useState("");
  const [isKernelClientReady, setIsKernelClientReady] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSendingUserOps, setIsSendingUserOps] = useState(false);
  const [sepoliaUserOpHash, setSepoliaUserOpHash] = useState("");
  const [opSepoliaUserOpHash, setOpSepoliaUserOpHash] = useState("");
  const [userOpsStatus, setUserOpsStatus] = useState("");

  const createAccountAndClient = async (
    multiChainWebAuthnValidators: any[]
  ) => {
    const mnemonic = await generateMnemonic(english);

    const recoverySigner = await mnemonicToAccount(mnemonic);
    console.log("account-->", recoverySigner);

    const recoveryValidator = await createWeightedECDSAValidator(publicClient, {
      signers: [recoverySigner],
      kernelVersion: KERNEL_V3_1,
      entryPoint,
      config: {
        threshold: 100,
        signers: [
          {
            address: recoverySigner.address,
            weight: 100,
          },
        ],
      },
    });
    const recoveryAction = getRecoveryAction(entryPoint.version);

    const recoveryPluginInstallModuleData =
      await getValidatorPluginInstallModuleData({
        entryPoint,
        kernelVersion: KERNEL_V3_1,
        plugin: recoveryValidator,
        action: recoveryAction,
      });
    const account = await createKernelAccount(publicClient, {
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      plugins: {
        sudo: multiChainWebAuthnValidators[0],
      },
      pluginMigrations: [
        recoveryPluginInstallModuleData,
        getRecoveryFallbackActionInstallModuleData(entryPoint.version),
      ],
      // Only needed to set after changing the sudo validator config i.e.
      // changing the threshold or adding/removing/updating signers
      // After doing recovery
      // address: accountAddress,
    });
    console.log("account", account);
    const kernelClient = createWeightedKernelAccountClient({
      account,
      chain: sepolia,
      bundlerTransport: http(SEPOLIA_BUNDLER_URL),
      // Optional -- only if you want to use a paymaster
      paymaster: {
        getPaymasterData(userOperation) {
          return paymasterClient.sponsorUserOperation({ userOperation });
        },
      },
    });
    const op1Hash = await kernelClient.sendUserOperation({
      callData: await kernelClient.account.encodeCalls([
        {
          to: zeroAddress,
          value: BigInt(0),
          data: "0x",
        },
      ]),
    });
    console.log("op1Hash-->", op1Hash);
    sepoliaKernelClient = kernelClient;

    // const sessionKeySigner = await toECDSASigner({
    //   signer: recoverySigner,
    // });

    const sessionPrivateKey = generatePrivateKey();
    const sessionKeyAccount = privateKeyToAccount(sessionPrivateKey);
    const sessionKeySigner = await toECDSASigner({
      signer: sessionKeyAccount,
    });

    console.log("sessionKeySigner", sessionKeySigner);

    const permissionPlugin = await toPermissionValidator(publicClient, {
      entryPoint,
      signer: sessionKeySigner,
      policies: [
        // In this example, we are just using a sudo policy to allow everything.
        // In practice, you would want to set more restrictive policies.
        toSudoPolicy({}),
      ],
      kernelVersion: KERNEL_V3_1,
    });

    console.log("permissionPlugin", permissionPlugin);

    const sessionKeyAccount1 = await createKernelAccount(publicClient, {
      entryPoint,
      plugins: {
        sudo: multiChainWebAuthnValidators[0],
        regular: permissionPlugin,
      },
      kernelVersion: KERNEL_V3_1,
    });
    console.log("sessionKeyAccount", sessionKeyAccount1);
    const serilaizeData = await serializePermissionAccount(sessionKeyAccount1, sessionPrivateKey);
    console.log("serilaizeData",serilaizeData)

    const kernelClient1 = createWeightedKernelAccountClient({
      account: sessionKeyAccount1,
      chain: sepolia,
      bundlerTransport: http(SEPOLIA_BUNDLER_URL),
      // Optional -- only if you want to use a paymaster
      paymaster: {
        getPaymasterData(userOperation) {
          return paymasterClient.sponsorUserOperation({ userOperation });
        },
      },
    });
    console.log("kernelClient1",kernelClient1)
    const op1Hash1 = await kernelClient1.sendUserOperation({
      callData: await kernelClient.account.encodeCalls([
        {
          to: zeroAddress,
          value: BigInt(0),
          data: "0x",
        },
      ]),
    });
    console.log("op1Hash1-->", op1Hash1);
    setIsKernelClientReady(true);
    setAccountAddress(account.address);
  };

  // Function to be called when "Register" is clicked
  const handleRegister = async () => {
    const webAuthnKey = await toWebAuthnKey({
      passkeyName: username,
      passkeyServerUrl: SEPOLIA_PASSKEY_SERVER_URL,
      mode: WebAuthnMode.Register,
      passkeyServerHeaders: {},
    });

    const newPasskeyValidator = await toPasskeyValidator(publicClient, {
      webAuthnKey,
      entryPoint,
      kernelVersion: KERNEL_V3_1,
      validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2,
    });
    console.log("WebAuthnKey: ", webAuthnKey);

    // createAccount(
    //     newPasskeyValidator,
    //     addressPhrase
    //   );

    await createAccountAndClient([newPasskeyValidator]);
    setIsRegistering(false);
    window.alert(
      "Register and session key approval done.  Try sending UserOps."
    );
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);

    setIsLoggingIn(false);
    window.alert("Login done.  Try sending UserOps.");
  };

  const handleSendUserOps = async () => {
    setIsSendingUserOps(true);
    setUserOpsStatus("Sending UserOp...");
    if (sepoliaKernelClient) {
      try {
        const quoteData = await ensoClient.getQuoteData({
          fromAddress: accountAddress,
          chainId: 1,
          amountIn: "1000000",
          tokenIn: USDC_CONTRACT_ADDRESS,
          tokenOut: USDT_CONTRACT_ADDRESS,
        });
        console.log("quoteData-->", quoteData);

        const approvalData = await ensoClient.getApprovalData({
          fromAddress: accountAddress,
          tokenAddress: USDC_CONTRACT_ADDRESS,
          chainId: 1,
          amount: "1000000",
        });
        console.log("approvalData--->", approvalData);

        const op1Hash = await sepoliaKernelClient.sendUserOperation({
          callData: await sepoliaKernelClient.account.encodeCalls([
            {
              to: approvalData.tx.to,
              value: BigInt(0),
              data: approvalData.tx.data,
            },
          ]),
        });

        console.log("Approval Transaction Hash:", op1Hash);
        const routeData = await ensoClient.getRouterData({
          fromAddress: accountAddress,
          receiver: accountAddress,
          spender: accountAddress,
          chainId: 1,
          amountIn: "1000000",
          tokenIn: USDC_CONTRACT_ADDRESS,
          tokenOut: USDT_CONTRACT_ADDRESS,
          routingStrategy: "router", // optional
        });
        console.log("routeData-->", routeData);

        const op2Hash = await sepoliaKernelClient.sendUserOperation({
          callData: await sepoliaKernelClient.account.encodeCalls([
            {
              to: routeData.tx.to, // The contract handling the swap
              value: BigInt(routeData.tx.value), // Amount of ETH to send if needed
              data: routeData.tx.data, // The actual swap transaction data
            },
          ]),
        });

        console.log("Swap Transaction Hash:", op2Hash);

        setIsSendingUserOps(false);
      } catch (error) {
        console.log("error-->", error);
        setUserOpsStatus(`status: error. Please check console`);
        setIsSendingUserOps(false);
      }
    } else {
      setIsSendingUserOps(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <></>;

  // Spinner component for visual feedback during loading states
  const Spinner = () => (
    <svg
      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );

  return (
    <main className="flex items-center justify-center min-h-screen px-4 py-24">
      <div className="w-full max-w-lg mx-auto">
        <h1 className="text-4xl font-semibold text-center mb-12">
          Zero Dev with Enso Swap
        </h1>

        <div className="space-y-4">
          {/* Account Address Label */}
          {accountAddress && (
            <div className="text-center mb-4">
              Account address:{" "}
              <a
                href={`https://jiffyscan.xyz/account/${accountAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
              >
                {" "}
                {accountAddress}{" "}
              </a>
            </div>
          )}

          {/* Input Box */}
          <input
            type="text"
            placeholder="Your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg w-full"
            style={{ color: "red" }}
          />

          {/* Register and Login Buttons */}
          <div className="flex flex-col sm:flex-row sm:space-x-4">
            {/* Register Button */}
            <button
              onClick={handleRegister}
              disabled={isRegistering || isLoggingIn}
              className="flex justify-center items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 w-full"
            >
              {isRegistering ? <Spinner /> : "Register"}
            </button>

            {/* Login Button */}
            {/* <button */}
            {/* onClick={handleLogin}
                            disabled={isLoggingIn || isRegistering}
                            className="mt-2 sm:mt-0 flex justify-center items-center px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 w-full"
                        >
                            {isLoggingIn ? <Spinner /> : "Login"}
                        </button> */}
          </div>

          {/* Send Multi-Chain UserOps Button */}
          <div className="flex flex-col items-center w-full">
            <button
              onClick={handleSendUserOps}
              disabled={!isKernelClientReady || isSendingUserOps}
              className={`px-4 py-2 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 flex justify-center items-center w-full ${
                isKernelClientReady && !isSendingUserOps
                  ? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
                  : "bg-gray-500"
              }`}
            >
              {isSendingUserOps ? <Spinner /> : "Enso Swap"}
            </button>
            {/* UserOp Status Label */}
            {sepoliaUserOpHash && opSepoliaUserOpHash && (
              <div
                className="mt-4"
                dangerouslySetInnerHTML={{
                  __html: userOpsStatus,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
