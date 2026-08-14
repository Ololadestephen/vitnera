// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { VitneraRWA } from "../src/VitneraRWA.sol";

contract DeployVitneraRWA is Script {
    bytes32 internal constant SOLAR_TEMPLATE = keccak256("solar-installation-v1");

    function run() external returns (VitneraRWA deployed) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address reviewer = vm.envAddress("REVIEWER_ADDRESS");
        address verifier = vm.envOr("VERIFIER_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);
        deployed = new VitneraRWA(deployer);
        deployed.setSupportedTemplate(SOLAR_TEMPLATE, true);
        deployed.setSupportedPolicyVersion(1, true);
        deployed.setAuthorizedReviewer(reviewer, true);
        if (verifier != address(0)) deployed.setAuthorizedVerifier(verifier, true);
        vm.stopBroadcast();
    }
}
